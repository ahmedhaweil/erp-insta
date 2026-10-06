import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SalesOrder,
  SalesOrderDeliveryStatus,
  SalesOrderInvoiceStatus,
  SalesOrderStatus,
} from '../entities/sales-order.entity';
import { SalesOrderLine } from '../entities/sales-order-line.entity';
import { SalesInvoice } from '../entities/sales-invoice.entity';
import { Customer } from '../entities/customer.entity';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { CreateInvoiceFromOrderDto, DeliverOrderDto } from '../dto/sales-actions.dto';
import { OrderConfirmedEvent } from '../events/order-confirmed.event';
import { SalesInvoicesService } from './sales-invoices.service';
import { SequenceService } from '@shared/services/sequence.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { computeLine, computeTotals, round, today } from '@shared/utils/document-totals.util';

@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly lineRepo: Repository<SalesOrderLine>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly eventEmitter: EventEmitter2,
    private readonly sequenceService: SequenceService,
    private readonly stockService: StockService,
    private readonly invoicesService: SalesInvoicesService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreateSalesOrderDto,
  ): Promise<SalesOrder> {
    const customer = await this.customerRepo.findOne({ where: { id: dto.customerId, tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    if (!customer.isActive) throw new BadRequestException('Customer is archived');

    const orderNumber = await this.sequenceService.next(tenantId, 'sales_order', 'SO');

    // Amounts are always recomputed server-side from quantities and prices
    const lines = dto.lines.map((l) => ({
      ...computeLine(l),
      productId: l.productId,
      description: l.description,
    }));
    const { subtotal, taxAmount, totalAmount } = computeTotals(lines);

    const order = this.orderRepo.create({
      ...dto,
      tenantId,
      orderNumber,
      createdBy: userId,
      status: SalesOrderStatus.DRAFT,
      subtotal,
      taxAmount,
      totalAmount,
      lines: lines.map((l) => this.lineRepo.create(l)),
    });

    return this.orderRepo.save(order);
  }

  async findAll(tenantId: string): Promise<SalesOrder[]> {
    return this.orderRepo.find({
      where: { tenantId },
      relations: ['lines', 'customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SalesOrder> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'customer'],
    });
    if (!order) throw new NotFoundException('Sales order not found');
    return order;
  }

  /** Marks a quotation as sent to the customer. */
  async markSent(tenantId: string, id: string): Promise<SalesOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new ConflictException('Only draft quotations can be marked as sent');
    }
    order.status = SalesOrderStatus.SENT;
    return this.orderRepo.save(order);
  }

  /**
   * Confirms a quotation into a sales order: enforces quotation validity and
   * the customer credit limit, then reserves stock in the order warehouse.
   */
  async confirm(tenantId: string, userId: string, id: string): Promise<SalesOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status !== SalesOrderStatus.DRAFT && order.status !== SalesOrderStatus.SENT) {
      throw new ConflictException('Only draft orders can be confirmed');
    }

    if (order.validityDate && order.validityDate < today()) {
      throw new ConflictException(`Quotation expired on ${order.validityDate}`);
    }

    const customer = order.customer;
    if (customer && Number(customer.creditLimit) > 0) {
      const exposure = Number(customer.balance) + Number(order.totalAmount);
      if (exposure > Number(customer.creditLimit)) {
        throw new BadRequestException(
          `Credit limit exceeded. Limit: ${customer.creditLimit}, Current balance: ${customer.balance}, Order: ${Number(order.totalAmount).toFixed(2)}`,
        );
      }
    }

    if (order.warehouseId) {
      for (const line of order.lines ?? []) {
        const reserved = await this.stockService.reserve(
          tenantId,
          line.productId,
          order.warehouseId,
          Number(line.quantity),
        );
        line.qtyReserved = reserved;
      }
      if (order.lines?.length) await this.lineRepo.save(order.lines);
    }

    order.status = SalesOrderStatus.CONFIRMED;
    order.invoiceStatus = SalesOrderInvoiceStatus.TO_INVOICE;
    const saved = await this.orderRepo.save(order);

    this.eventEmitter.emit(
      'order.confirmed',
      new OrderConfirmedEvent(
        tenantId,
        userId,
        order.id,
        order.orderNumber,
        Number(order.totalAmount),
      ),
    );

    return saved;
  }

  /**
   * Validates a (full or partial) delivery: issues goods from stock, consumes
   * reservations and posts the cost of goods sold.
   */
  async deliver(
    tenantId: string,
    userId: string,
    id: string,
    dto: DeliverOrderDto = {},
  ): Promise<SalesOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== SalesOrderStatus.CONFIRMED) {
      throw new ConflictException('Only confirmed orders can be delivered');
    }

    const warehouseId = dto.warehouseId || order.warehouseId;
    const requested = new Map((dto.lines ?? []).map((l) => [l.lineId, Number(l.quantity)]));
    const date = dto.date || today();
    let totalCost = 0;
    let delivered = 0;

    await this.autoPosting.preflight(tenantId, date, ['cogsAccountId', 'inventoryAccountId']);

    for (const line of order.lines) {
      const remaining = round(Number(line.quantity) - Number(line.qtyDelivered), 4);
      const quantity = dto.lines ? requested.get(line.id) ?? 0 : remaining;
      if (quantity <= 0) continue;
      if (quantity > remaining + 0.0001) {
        throw new BadRequestException('Delivered quantity exceeds the remaining ordered quantity');
      }

      const releaseReserved =
        warehouseId === order.warehouseId ? Math.min(Number(line.qtyReserved), quantity) : 0;
      if (!warehouseId) {
        if (await this.stockService.isStockable(tenantId, line.productId)) {
          throw new BadRequestException('A warehouse is required to deliver stockable products');
        }
      } else {
        const { cost } = await this.stockService.issue(tenantId, userId, {
          productId: line.productId,
          warehouseId,
          quantity,
          releaseReserved,
          referenceType: 'sales_order',
          referenceId: order.id,
          description: `Delivery ${order.orderNumber}`,
        });
        totalCost += cost;
      }

      line.qtyDelivered = round(Number(line.qtyDelivered) + quantity, 4);
      line.qtyReserved = Math.max(round(Number(line.qtyReserved) - releaseReserved, 4), 0);
      delivered += quantity;
    }

    if (delivered === 0) throw new BadRequestException('Nothing to deliver');
    await this.lineRepo.save(order.lines);

    totalCost = round(totalCost, 4);
    if (totalCost > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Cost of goods sold ${order.orderNumber}`,
        sourceType: 'sales_delivery',
        sourceId: order.id,
        buildLines: (_s, account) => [
          { accountId: account('cogsAccountId'), debit: totalCost },
          { accountId: account('inventoryAccountId'), credit: totalCost },
        ],
      });
    }

    const fullyDelivered = order.lines.every(
      (l) => Number(l.qtyDelivered) >= Number(l.quantity) - 0.0001,
    );
    order.deliveryStatus = fullyDelivered
      ? SalesOrderDeliveryStatus.DELIVERED
      : SalesOrderDeliveryStatus.PARTIAL;
    if (fullyDelivered) order.status = SalesOrderStatus.DELIVERED;
    return this.orderRepo.save(order);
  }

  /** Creates a draft invoice for what is left to invoice on the order. */
  async createInvoice(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreateInvoiceFromOrderDto = {},
  ): Promise<SalesInvoice> {
    const order = await this.findById(tenantId, id);
    if (order.status !== SalesOrderStatus.CONFIRMED && order.status !== SalesOrderStatus.DELIVERED) {
      throw new ConflictException('Only confirmed orders can be invoiced');
    }

    const policy = dto.policy ?? 'ordered';
    const toInvoice = order.lines
      .map((line) => {
        const basis = policy === 'delivered' ? Number(line.qtyDelivered) : Number(line.quantity);
        const quantity = round(basis - Number(line.qtyInvoiced), 4);
        return { line, quantity };
      })
      .filter((x) => x.quantity > 0);

    if (toInvoice.length === 0) {
      throw new BadRequestException(
        policy === 'delivered'
          ? 'Nothing to invoice: deliver the goods first or invoice ordered quantities'
          : 'The order is already fully invoiced',
      );
    }

    const date = dto.date || today();
    const invoice = await this.invoicesService.create(
      tenantId,
      userId,
      {
        customerId: order.customerId,
        orderId: order.id,
        date,
        currencyId: order.currencyId,
        exchangeRate: Number(order.exchangeRate),
        branchId: order.branchId,
        notes: `Invoice for ${order.orderNumber}`,
        lines: toInvoice.map(({ line, quantity }) => ({
          productId: line.productId,
          quantity,
          unitPrice: Number(line.unitPrice),
          discount: round((Number(line.discount) * quantity) / Number(line.quantity), 4),
          taxRate: Number(line.taxRate),
          description: line.description,
          orderLineId: line.id,
        })),
      },
    );

    for (const { line, quantity } of toInvoice) {
      line.qtyInvoiced = round(Number(line.qtyInvoiced) + quantity, 4);
    }
    await this.lineRepo.save(order.lines);

    const fullyInvoiced = order.lines.every(
      (l) => Number(l.qtyInvoiced) >= Number(l.quantity) - 0.0001,
    );
    order.invoiceStatus = fullyInvoiced
      ? SalesOrderInvoiceStatus.INVOICED
      : SalesOrderInvoiceStatus.PARTIAL;
    await this.orderRepo.save(order);

    return dto.post ? this.invoicesService.post(tenantId, userId, invoice.id) : invoice;
  }

  async cancel(tenantId: string, id: string): Promise<SalesOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status === SalesOrderStatus.CANCELLED) {
      throw new ConflictException('Order is already cancelled');
    }

    if (order.status === SalesOrderStatus.DELIVERED) {
      throw new ConflictException('Delivered orders cannot be cancelled');
    }

    const lines = order.lines ?? [];
    if (lines.some((l) => Number(l.qtyDelivered) > 0)) {
      throw new ConflictException('Partially delivered orders cannot be cancelled; return the goods first');
    }
    if (lines.some((l) => Number(l.qtyInvoiced) > 0)) {
      throw new ConflictException('Invoiced orders cannot be cancelled; cancel or credit the invoices first');
    }

    if (order.warehouseId) {
      for (const line of lines) {
        if (Number(line.qtyReserved) > 0) {
          await this.stockService.release(tenantId, line.productId, order.warehouseId, Number(line.qtyReserved));
          line.qtyReserved = 0;
        }
      }
      if (lines.length) await this.lineRepo.save(lines);
    }

    order.status = SalesOrderStatus.CANCELLED;
    order.invoiceStatus = SalesOrderInvoiceStatus.NOTHING;
    return this.orderRepo.save(order);
  }
}
