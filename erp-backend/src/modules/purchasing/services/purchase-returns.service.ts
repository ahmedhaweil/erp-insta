import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PurchaseReturn,
  PurchaseReturnLine,
  PurchaseReturnRefundMethod,
  PurchaseReturnStatus,
} from '../entities/purchase-return.entity';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  PurchaseInvoiceType,
} from '../entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from '../entities/purchase-invoice-line.entity';
import { Supplier } from '../entities/supplier.entity';
import { CreatePurchaseReturnDto } from '../dto/purchase-return.dto';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { StockService } from '@modules/inventory/services/stock.service';
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
 * Purchase returns: takes the goods out of stock and issues the vendor
 * refund automatically (Dr payable / Cr inventory for goods, purchase
 * return or purchase for non-stock items, Cr input VAT). The difference
 * between the refund value and the average cost leaving stock is posted to
 * the stock adjustment account when configured.
 */
@Injectable()
export class PurchaseReturnsService {
  constructor(
    @InjectRepository(PurchaseReturn)
    private readonly returnRepo: Repository<PurchaseReturn>,
    @InjectRepository(PurchaseReturnLine)
    private readonly returnLineRepo: Repository<PurchaseReturnLine>,
    @InjectRepository(PurchaseInvoiceLine)
    private readonly billLineRepo: Repository<PurchaseInvoiceLine>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly invoicesService: PurchaseInvoicesService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreatePurchaseReturnDto): Promise<PurchaseReturn> {
    let header: Partial<PurchaseReturn>;
    let lines: Partial<PurchaseReturnLine>[];

    if (dto.originalBillId) {
      const bill = await this.invoicesService.findById(tenantId, dto.originalBillId);
      this.assertReturnableBill(bill);
      if (dto.supplierId && dto.supplierId !== bill.supplierId) {
        throw new BadRequestException('The vendor does not match the original bill');
      }
      const byId = new Map(bill.lines.map((l) => [l.id, l]));
      lines = dto.lines.map((l) => {
        const source = l.invoiceLineId ? byId.get(l.invoiceLineId) : undefined;
        if (!source) {
          throw new BadRequestException('Each line must reference a line of the original bill');
        }
        const available = PurchaseReturnsService.returnableQuantity(source);
        if (l.quantity > available + 0.0001) {
          throw new BadRequestException(
            `Returned quantity ${l.quantity} exceeds the returnable quantity ${available} (billed minus already returned)`,
          );
        }
        return {
          billLineId: source.id,
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
        supplierId: bill.supplierId,
        originalBillId: bill.id,
        pricesIncludeTax: !!bill.pricesIncludeTax,
        currencyId: bill.currencyId,
        exchangeRate: Number(bill.exchangeRate || 1),
        branchId: bill.branchId,
      };
    } else {
      if (!dto.supplierId) {
        throw new BadRequestException('supplierId is required for returns without an original bill');
      }
      const supplier = await this.supplierRepo.findOne({ where: { id: dto.supplierId, tenantId } });
      if (!supplier) throw new NotFoundException('Supplier not found');
      lines = dto.lines.map((l) => {
        if (!l.productId || l.unitPrice === undefined) {
          throw new BadRequestException(
            'productId and unitPrice are required on returns without an original bill',
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
        supplierId: supplier.id,
        originalBillId: null,
        pricesIncludeTax: !!dto.pricesIncludeTax,
        currencyId: dto.currencyId ?? null,
        exchangeRate: Number(dto.exchangeRate ?? 1),
        branchId: dto.branchId ?? null,
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

    const saved = await this.returnRepo.save(
      this.returnRepo.create({
        ...header,
        tenantId,
        returnNumber: await this.sequenceService.next(tenantId, 'purchase_return', 'PRET'),
        warehouseId: dto.warehouseId ?? null,
        date: dto.date || today(),
        reason: dto.reason,
        refundMethod:
          (dto.refundMethod as unknown as PurchaseReturnRefundMethod) ??
          PurchaseReturnRefundMethod.CREDIT,
        status: PurchaseReturnStatus.DRAFT,
        createdBy: userId,
        ...totals,
        lines: computed.map(({ taxAmount: _t, ...l }) => this.returnLineRepo.create(l)),
      }),
    );
    return dto.post ? this.post(tenantId, userId, saved.id) : saved;
  }

  async findAll(tenantId: string, filters: { supplierId?: string; billId?: string } = {}) {
    const where: Record<string, unknown> = { tenantId };
    if (filters.supplierId) where.supplierId = filters.supplierId;
    if (filters.billId) where.originalBillId = filters.billId;
    return this.returnRepo.find({
      where,
      relations: ['lines', 'supplier'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PurchaseReturn> {
    const found = await this.returnRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'supplier'],
    });
    if (!found) throw new NotFoundException('Purchase return not found');
    return found;
  }

  async post(tenantId: string, userId: string, id: string): Promise<PurchaseReturn> {
    const ret = await this.findById(tenantId, id);
    if (ret.status !== PurchaseReturnStatus.DRAFT) {
      throw new ConflictException('Only draft returns can be posted');
    }

    const products = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(ret.lines.map((l) => l.productId))]) },
    });
    const isGoods = new Map(products.map((p) => [p.id, p.type === ProductType.GOODS]));
    const keys: Parameters<AutoPostingService['preflight']>[2] = [
      'payableAccountId',
      'inputTaxAccountId',
    ];
    if (ret.lines.some((l) => isGoods.get(l.productId))) keys.push('inventoryAccountId');
    if (ret.lines.some((l) => !isGoods.get(l.productId))) keys.push('purchaseAccountId');
    if (ret.refundMethod === PurchaseReturnRefundMethod.CASH) keys.push('cashAccountId');
    await this.autoPosting.preflight(tenantId, ret.date, keys);

    // 1. Returnable quantities (billed minus already returned per line)
    let bill: PurchaseInvoice | null = null;
    if (ret.originalBillId) {
      bill = await this.invoicesService.findById(tenantId, ret.originalBillId);
      this.assertReturnableBill(bill);
      const byId = new Map(bill.lines.map((l) => [l.id, l]));
      const requested = new Map<string, number>();
      for (const line of ret.lines) {
        requested.set(line.billLineId!, (requested.get(line.billLineId!) ?? 0) + Number(line.quantity));
      }
      for (const [lineId, qty] of requested) {
        const source = byId.get(lineId);
        if (!source) throw new BadRequestException('Return line no longer matches the bill');
        const available = PurchaseReturnsService.returnableQuantity(source);
        if (qty > available + 0.0001) {
          throw new BadRequestException(
            `Returned quantity ${qty} exceeds the returnable quantity ${available} on the bill line`,
          );
        }
        source.qtyReturned = round(Number(source.qtyReturned || 0) + qty, 4);
      }
      await this.billLineRepo.save([...requested.keys()].map((k) => byId.get(k)!));
    }

    // 2. Goods leave stock at the current average cost
    const rate = Number(ret.exchangeRate || 1) || 1;
    let totalCost = 0;
    let valueDifference = 0;
    for (const line of ret.lines) {
      if (!isGoods.get(line.productId)) continue;
      const refundValue = Number(line.lineTotal) * rate;
      if (!line.restock) {
        valueDifference += refundValue;
        continue;
      }
      if (!ret.warehouseId) {
        throw new BadRequestException('A warehouse is required to return stockable goods');
      }
      const { unitCost, cost } = await this.stockService.issue(tenantId, userId, {
        productId: line.productId,
        warehouseId: ret.warehouseId,
        quantity: Number(line.quantity),
        referenceType: 'purchase_return',
        referenceId: ret.id,
        description: `Purchase return ${ret.returnNumber}`,
      });
      line.unitCost = unitCost;
      totalCost += cost;
      valueDifference += refundValue - cost;
    }
    totalCost = round(totalCost, 4);
    valueDifference = round(valueDifference, 4);
    if (ret.lines.length) await this.returnLineRepo.save(ret.lines);

    // 3. Vendor refund (debit note), reconciled with the bill when it is open
    const billLines = new Map((bill?.lines ?? []).map((l) => [l.id, l]));
    const refund = await this.invoicesService.create(
      tenantId,
      userId,
      {
        supplierId: ret.supplierId,
        date: ret.date,
        dueDate: ret.date,
        currencyId: ret.currencyId ?? undefined,
        exchangeRate: rate,
        branchId: ret.branchId ?? undefined,
        pricesIncludeTax: ret.pricesIncludeTax,
        withholdingRate: Number(bill?.withholdingRate ?? 0),
        notes: `Purchase return ${ret.returnNumber}${bill ? ` of ${bill.invoiceNumber}` : ''}${ret.reason ? `: ${ret.reason}` : ''}`,
        lines: ret.lines.map((l) => ({
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount),
          taxRate: Number(l.taxRate),
          description: l.description,
          withholdingRate:
            l.billLineId && billLines.get(l.billLineId)?.withholdingRate != null
              ? Number(billLines.get(l.billLineId)!.withholdingRate)
              : undefined,
        })),
      },
      {
        moveType: PurchaseInvoiceType.REFUND,
        reversedInvoiceId: bill?.id,
        purchaseReturnId: ret.id,
      },
    );
    let approved = await this.invoicesService.approve(tenantId, refund.id, userId);

    // 4. Align the inventory account with the stock valuation
    if (valueDifference !== 0) {
      const diff = Math.abs(valueDifference);
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: ret.date,
        description: `Purchase return ${ret.returnNumber} - valuation difference`,
        sourceType: 'purchase_return',
        sourceId: ret.id,
        buildLines: (s, account) => {
          if (!s.stockAdjustmentAccountId) return [];
          return valueDifference > 0
            ? [
                { accountId: account('inventoryAccountId'), debit: diff },
                { accountId: s.stockAdjustmentAccountId, credit: diff },
              ]
            : [
                { accountId: s.stockAdjustmentAccountId, debit: diff },
                { accountId: account('inventoryAccountId'), credit: diff },
              ];
        },
      });
    }

    // 5. Cash received back from the vendor
    if (ret.refundMethod === PurchaseReturnRefundMethod.CASH) {
      approved = await this.invoicesService.findById(tenantId, approved.id);
      const amount = residual(approved.totalAmount, approved.paidAmount);
      if (amount > 0) {
        await this.autoPosting.post({
          tenantId,
          userId,
          journalType: JournalType.CASH,
          date: ret.date,
          description: `Cash refund from vendor for ${ret.returnNumber}`,
          sourceType: 'purchase_return_refund',
          sourceId: ret.id,
          currencyId: ret.currencyId ?? undefined,
          exchangeRate: rate,
          buildLines: (_s, account) => [
            { accountId: account('cashAccountId'), debit: amount },
            { accountId: account('payableAccountId'), credit: amount },
          ],
        });
        await this.invoicesService.adjustSupplierBalance(tenantId, ret.supplierId, amount);
        await this.invoicesService.applyPayment(approved, amount);
      }
    }

    ret.status = PurchaseReturnStatus.POSTED;
    ret.postedAt = new Date();
    ret.refundId = refund.id;
    ret.costAmount = totalCost;
    const { lines: _l, supplier: _s, ...headerOnly } = ret;
    await this.returnRepo.save(headerOnly as PurchaseReturn);
    return this.findById(tenantId, ret.id);
  }

  async cancel(tenantId: string, id: string): Promise<PurchaseReturn> {
    const ret = await this.findById(tenantId, id);
    if (ret.status !== PurchaseReturnStatus.DRAFT) {
      throw new ConflictException('Only draft returns can be cancelled');
    }
    ret.status = PurchaseReturnStatus.CANCELLED;
    const { lines: _l, supplier: _s, ...headerOnly } = ret;
    await this.returnRepo.save(headerOnly as PurchaseReturn);
    return ret;
  }

  static returnableQuantity(line: Pick<PurchaseInvoiceLine, 'quantity' | 'qtyReturned'>): number {
    return Math.max(round(Number(line.quantity) - Number(line.qtyReturned || 0), 4), 0);
  }

  private assertReturnableBill(bill: PurchaseInvoice): void {
    if (bill.moveType === PurchaseInvoiceType.REFUND) {
      throw new BadRequestException('Returns must reference a bill, not a vendor refund');
    }
    if (bill.status === PurchaseInvoiceStatus.DRAFT || bill.status === PurchaseInvoiceStatus.CANCELLED) {
      throw new ConflictException('Returns can only reference approved bills');
    }
  }
}
