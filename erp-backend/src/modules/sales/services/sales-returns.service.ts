import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ReturnRefundMethod,
  SalesReturn,
  SalesReturnLine,
  SalesReturnStatus,
} from '../entities/sales-return.entity';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../entities/sales-invoice.entity';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.entity';
import { SalesOrderLine } from '../entities/sales-order-line.entity';
import { Customer } from '../entities/customer.entity';
import { CreateSalesReturnDto } from '../dto/sales-return.dto';
import { SalesInvoicesService } from './sales-invoices.service';
import { StockService } from '@modules/inventory/services/stock.service';
import {
  StockMovement,
  StockMovementType,
} from '@modules/inventory/entities/stock-movement.entity';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import {
  computeLine,
  computeTotals,
  residual,
  round,
  today,
} from '@shared/utils/document-totals.util';

/**
 * Sales returns: puts returned goods back into stock at their original cost
 * (Dr inventory / Cr COGS) and issues the credit note automatically
 * (Dr sales return or sales + output VAT / Cr receivable), optionally
 * refunded in cash (Dr receivable / Cr cash).
 */
@Injectable()
export class SalesReturnsService {
  constructor(
    @InjectRepository(SalesReturn)
    private readonly returnRepo: Repository<SalesReturn>,
    @InjectRepository(SalesReturnLine)
    private readonly returnLineRepo: Repository<SalesReturnLine>,
    @InjectRepository(SalesInvoiceLine)
    private readonly invoiceLineRepo: Repository<SalesInvoiceLine>,
    @InjectRepository(SalesOrderLine)
    private readonly orderLineRepo: Repository<SalesOrderLine>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(StockMovement)
    private readonly movementRepo: Repository<StockMovement>,
    private readonly invoicesService: SalesInvoicesService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateSalesReturnDto): Promise<SalesReturn> {
    const date = dto.date || today();
    let header: Partial<SalesReturn>;
    let lines: Partial<SalesReturnLine>[];

    if (dto.originalInvoiceId) {
      const invoice = await this.invoicesService.findById(tenantId, dto.originalInvoiceId);
      this.assertReturnableInvoice(invoice);
      if (dto.customerId && dto.customerId !== invoice.customerId) {
        throw new BadRequestException('The customer does not match the original invoice');
      }
      const byId = new Map(invoice.lines.map((l) => [l.id, l]));
      lines = dto.lines.map((l) => {
        const source = l.invoiceLineId ? byId.get(l.invoiceLineId) : undefined;
        if (!source) {
          throw new BadRequestException('Each line must reference a line of the original invoice');
        }
        const available = SalesReturnsService.returnableQuantity(source);
        if (l.quantity > available + 0.0001) {
          throw new BadRequestException(
            `Returned quantity ${l.quantity} exceeds the returnable quantity ${available} (invoiced minus already returned)`,
          );
        }
        return {
          invoiceLineId: source.id,
          productId: source.productId,
          quantity: l.quantity,
          unitPrice: Number(source.unitPrice),
          discount: round((Number(source.discount) * l.quantity) / Number(source.quantity), 4),
          taxRate: Number(source.taxRate),
          restock: l.restock !== false,
          description: l.description ?? source.description,
        };
      });
      header = {
        customerId: invoice.customerId,
        originalInvoiceId: invoice.id,
        pricesIncludeTax: !!invoice.pricesIncludeTax,
        currencyId: invoice.currencyId,
        exchangeRate: Number(invoice.exchangeRate || 1),
        branchId: invoice.branchId,
        salesRepId: invoice.salesRepId,
      };
    } else {
      if (!dto.customerId) {
        throw new BadRequestException('customerId is required for returns without an original invoice');
      }
      const customer = await this.customerRepo.findOne({ where: { id: dto.customerId, tenantId } });
      if (!customer) throw new NotFoundException('Customer not found');
      lines = dto.lines.map((l) => {
        if (!l.productId || l.unitPrice === undefined) {
          throw new BadRequestException(
            'productId and unitPrice are required on returns without an original invoice',
          );
        }
        return {
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount ?? 0,
          taxRate: l.taxRate ?? 0,
          restock: l.restock !== false,
          description: l.description,
        };
      });
      header = {
        customerId: customer.id,
        originalInvoiceId: null,
        pricesIncludeTax: !!dto.pricesIncludeTax,
        currencyId: dto.currencyId ?? null,
        exchangeRate: Number(dto.exchangeRate ?? 1),
        branchId: dto.branchId ?? null,
        salesRepId: customer.salesRepId ?? null,
      };
    }

    const computed = lines.map((l) => ({
      ...l,
      ...computeLine(
        {
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount),
          taxRate: Number(l.taxRate),
        },
        { taxIncluded: !!header.pricesIncludeTax },
      ),
    }));
    const totals = computeTotals(computed);

    const salesReturn = this.returnRepo.create({
      ...header,
      tenantId,
      returnNumber: await this.sequenceService.next(tenantId, 'sales_return', 'SRET'),
      warehouseId: dto.warehouseId ?? null,
      date,
      reason: dto.reason,
      refundMethod: dto.refundMethod ?? ReturnRefundMethod.CREDIT,
      status: SalesReturnStatus.DRAFT,
      createdBy: userId,
      ...totals,
      lines: computed.map(({ taxAmount: _t, ...l }) => this.returnLineRepo.create(l)),
    });
    const saved = await this.returnRepo.save(salesReturn);
    return dto.post ? this.post(tenantId, userId, saved.id) : saved;
  }

  async findAll(tenantId: string, filters: { customerId?: string; invoiceId?: string } = {}) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.invoiceId) where.originalInvoiceId = filters.invoiceId;
    return this.returnRepo.find({
      where,
      relations: ['lines', 'customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SalesReturn> {
    const found = await this.returnRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'customer'],
    });
    if (!found) throw new NotFoundException('Sales return not found');
    return found;
  }

  /**
   * Validates a draft return: re-checks the returnable quantities, restocks
   * the goods at their original cost, posts Dr inventory / Cr COGS, issues
   * and posts the credit note and, for cash returns, pays it out.
   */
  async post(tenantId: string, userId: string, id: string): Promise<SalesReturn> {
    const ret = await this.findById(tenantId, id);
    if (ret.status !== SalesReturnStatus.DRAFT) {
      throw new ConflictException('Only draft returns can be posted');
    }

    const keys: Parameters<AutoPostingService['preflight']>[2] = [
      'receivableAccountId',
      'salesAccountId',
      'outputTaxAccountId',
    ];
    const restockLines = ret.lines.filter((l) => l.restock);
    if (restockLines.length) keys.push('inventoryAccountId', 'cogsAccountId');
    if (ret.refundMethod === ReturnRefundMethod.CASH) keys.push('cashAccountId');
    await this.autoPosting.preflight(tenantId, ret.date, keys);

    // 1. Returnable quantities (invoiced minus already returned per line)
    let invoice: SalesInvoice | null = null;
    if (ret.originalInvoiceId) {
      invoice = await this.invoicesService.findById(tenantId, ret.originalInvoiceId);
      this.assertReturnableInvoice(invoice);
      const byId = new Map(invoice.lines.map((l) => [l.id, l]));
      const requested = new Map<string, number>();
      for (const line of ret.lines) {
        requested.set(
          line.invoiceLineId!,
          (requested.get(line.invoiceLineId!) ?? 0) + Number(line.quantity),
        );
      }
      for (const [lineId, qty] of requested) {
        const source = byId.get(lineId);
        if (!source) throw new BadRequestException('Return line no longer matches the invoice');
        const available = SalesReturnsService.returnableQuantity(source);
        if (qty > available + 0.0001) {
          throw new BadRequestException(
            `Returned quantity ${qty} exceeds the returnable quantity ${available} on the invoice line`,
          );
        }
        source.qtyReturned = round(Number(source.qtyReturned || 0) + qty, 4);
      }
      await this.invoiceLineRepo.save([...requested.keys()].map((k) => byId.get(k)!));
    }

    // 2. Restock at the original cost
    let totalCost = 0;
    const originalCosts = await this.originalUnitCosts(tenantId, invoice, ret.lines);
    for (const line of ret.lines) {
      if (!line.restock) continue;
      const stockable = await this.stockService.isStockable(tenantId, line.productId);
      if (!stockable) continue;
      if (!ret.warehouseId) {
        throw new BadRequestException('A warehouse is required to restock returned goods');
      }
      const unitCost =
        originalCosts.get(line.id) ?? (await this.stockService.getUnitCost(tenantId, line.productId));
      await this.stockService.receive(tenantId, userId, {
        productId: line.productId,
        warehouseId: ret.warehouseId,
        quantity: Number(line.quantity),
        unitCost,
        referenceType: 'sales_return',
        referenceId: ret.id,
        description: `Sales return ${ret.returnNumber}`,
      });
      line.unitCost = unitCost;
      totalCost += unitCost * Number(line.quantity);
    }
    totalCost = round(totalCost, 4);
    if (ret.lines.length) await this.returnLineRepo.save(ret.lines);

    if (totalCost > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: ret.date,
        description: `Sales return ${ret.returnNumber} - goods back to stock`,
        sourceType: 'sales_return',
        sourceId: ret.id,
        buildLines: (_s, account) => [
          { accountId: account('inventoryAccountId'), debit: totalCost },
          { accountId: account('cogsAccountId'), credit: totalCost },
        ],
      });
    }

    // 3. Credit note (reconciled with the original invoice when it is open)
    const invoiceLines = new Map((invoice?.lines ?? []).map((l) => [l.id, l]));
    const creditNote = await this.invoicesService.create(
      tenantId,
      userId,
      {
        customerId: ret.customerId,
        date: ret.date,
        dueDate: ret.date,
        currencyId: ret.currencyId ?? undefined,
        exchangeRate: Number(ret.exchangeRate || 1),
        branchId: ret.branchId ?? undefined,
        salesRepId: ret.salesRepId ?? undefined,
        pricesIncludeTax: ret.pricesIncludeTax,
        withholdingRate: Number(invoice?.withholdingRate ?? 0),
        notes: `Sales return ${ret.returnNumber}${invoice ? ` of ${invoice.invoiceNumber}` : ''}${ret.reason ? `: ${ret.reason}` : ''}`,
        lines: ret.lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount),
          taxRate: Number(l.taxRate),
          description: l.description,
          withholdingRate:
            l.invoiceLineId && invoiceLines.get(l.invoiceLineId)?.withholdingRate != null
              ? Number(invoiceLines.get(l.invoiceLineId)!.withholdingRate)
              : undefined,
        })),
      },
      {
        moveType: SalesInvoiceType.CREDIT_NOTE,
        reversedInvoiceId: invoice?.id,
        salesReturnId: ret.id,
      },
      { skipPriceChecks: true },
    );
    let posted = await this.invoicesService.post(tenantId, userId, creditNote.id);

    // 4. Cash refund of what the credit note did not settle on the invoice
    if (ret.refundMethod === ReturnRefundMethod.CASH) {
      posted = await this.invoicesService.findById(tenantId, posted.id);
      const amount = residual(posted.totalAmount, posted.paidAmount);
      if (amount > 0) {
        await this.autoPosting.post({
          tenantId,
          userId,
          journalType: JournalType.CASH,
          date: ret.date,
          description: `Cash refund of sales return ${ret.returnNumber}`,
          sourceType: 'sales_return_refund',
          sourceId: ret.id,
          currencyId: ret.currencyId ?? undefined,
          exchangeRate: Number(ret.exchangeRate || 1),
          buildLines: (_s, account) => [
            { accountId: account('receivableAccountId'), debit: amount },
            { accountId: account('cashAccountId'), credit: amount },
          ],
        });
        await this.invoicesService.adjustCustomerBalance(tenantId, ret.customerId, amount);
        await this.invoicesService.applyPayment(posted, amount);
      }
    }

    ret.status = SalesReturnStatus.POSTED;
    ret.postedAt = new Date();
    ret.creditNoteId = creditNote.id;
    ret.costAmount = totalCost;
    const { lines: _l, customer: _c, ...headerOnly } = ret;
    await this.returnRepo.save(headerOnly as SalesReturn);
    return this.findById(tenantId, ret.id);
  }

  async cancel(tenantId: string, id: string): Promise<SalesReturn> {
    const ret = await this.findById(tenantId, id);
    if (ret.status !== SalesReturnStatus.DRAFT) {
      throw new ConflictException(
        'Only draft returns can be cancelled; re-invoice the goods to undo a posted return',
      );
    }
    ret.status = SalesReturnStatus.CANCELLED;
    const { lines: _l, customer: _c, ...headerOnly } = ret;
    await this.returnRepo.save(headerOnly as SalesReturn);
    return ret;
  }

  static returnableQuantity(line: Pick<SalesInvoiceLine, 'quantity' | 'qtyReturned'>): number {
    return Math.max(round(Number(line.quantity) - Number(line.qtyReturned || 0), 4), 0);
  }

  private assertReturnableInvoice(invoice: SalesInvoice): void {
    if (invoice.moveType === SalesInvoiceType.CREDIT_NOTE) {
      throw new BadRequestException('Returns must reference an invoice, not a credit note');
    }
    if (
      invoice.status === SalesInvoiceStatus.DRAFT ||
      invoice.status === SalesInvoiceStatus.CANCELLED
    ) {
      throw new ConflictException('Returns can only reference posted invoices');
    }
  }

  /**
   * Unit cost recorded when the goods were delivered (weighted average of
   * the delivery stock moves of the originating sales order), per return
   * line. Lines without a recorded delivery fall back to the current cost.
   */
  private async originalUnitCosts(
    tenantId: string,
    invoice: SalesInvoice | null,
    lines: SalesReturnLine[],
  ): Promise<Map<string, number>> {
    const costs = new Map<string, number>();
    if (!invoice) return costs;
    const invoiceLines = new Map(invoice.lines.map((l) => [l.id, l]));
    const orderLineIds = [
      ...new Set(
        lines
          .map((l) => (l.invoiceLineId ? invoiceLines.get(l.invoiceLineId)?.orderLineId : null))
          .filter((x): x is string => !!x),
      ),
    ];
    if (orderLineIds.length === 0) return costs;
    const orderLines = await this.orderLineRepo.find({ where: { id: In(orderLineIds) } });
    const orderOf = new Map(orderLines.map((ol) => [ol.id, ol.orderId]));
    const orderIds = [...new Set(orderLines.map((ol) => ol.orderId))];
    const moves = await this.movementRepo.find({
      where: {
        tenantId,
        referenceType: 'sales_order',
        referenceId: In(orderIds),
        type: StockMovementType.OUT,
      },
    });
    for (const line of lines) {
      const orderLineId = line.invoiceLineId ? invoiceLines.get(line.invoiceLineId)?.orderLineId : null;
      const orderId = orderLineId ? orderOf.get(orderLineId) : undefined;
      if (!orderId) continue;
      const relevant = moves.filter(
        (m) => m.referenceId === orderId && m.productId === line.productId,
      );
      const qty = relevant.reduce((sum, m) => sum + Math.abs(Number(m.quantity)), 0);
      if (qty > 0) {
        const value = relevant.reduce(
          (sum, m) => sum + Math.abs(Number(m.quantity)) * Number(m.unitCost),
          0,
        );
        costs.set(line.id, round(value / qty, 4));
      }
    }
    return costs;
  }
}
