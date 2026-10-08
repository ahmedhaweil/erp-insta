import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PurchaseOrder,
  PurchaseOrderBillStatus,
  PurchaseOrderStatus,
} from '../entities/purchase-order.entity';
import { PurchaseOrderLine } from '../entities/purchase-order-line.entity';
import { PurchaseInvoice } from '../entities/purchase-invoice.entity';
import { Supplier } from '../entities/supplier.entity';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { CreateBillFromOrderDto, ReceiveOrderDto } from '../dto/purchase-actions.dto';
import { PurchaseReceivedEvent } from '../events/purchase-received.event';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { StockService } from '@modules/inventory/services/stock.service';
import { ProductsService } from '@modules/inventory/services/products.service';
import { resolveLineUnits, toBaseQty } from '@modules/inventory/services/document-units.util';
import { addLots, lotsOrUndefined } from '@modules/inventory/services/document-lots.util';
import { SequenceService } from '@shared/services/sequence.service';
import { RbacService } from '@modules/auth/services/rbac.service';
import { PurchasingSettingsService } from './purchasing-settings.service';

export const PO_APPROVAL_PERMISSION = {
  module: 'purchasing',
  screen: 'po_approval',
  action: 'approve',
};
import { computeLine, computeTotals, round, today, withDefaultTaxRates } from '@shared/utils/document-totals.util';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderLine)
    private readonly lineRepo: Repository<PurchaseOrderLine>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly eventEmitter: EventEmitter2,
    private readonly sequenceService: SequenceService,
    private readonly stockService: StockService,
    private readonly invoicesService: PurchaseInvoicesService,
    @Optional() private readonly settingsService?: PurchasingSettingsService,
    @Optional() private readonly rbac?: RbacService,
    @Optional() private readonly products?: ProductsService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
    extra: { requisitionId?: string } = {},
  ): Promise<PurchaseOrder> {
    const supplier = await this.supplierRepo.findOne({ where: { id: dto.supplierId, tenantId } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    if (!supplier.isActive) throw new BadRequestException('Supplier is archived');

    const orderNumber = await this.sequenceService.next(tenantId, 'purchase_order', 'PO');

    // Client totals are ignored: amounts are recomputed from the lines
    const taxIncluded = !!dto.pricesIncludeTax;
    const inputLines = await resolveLineUnits(
      this.products,
      tenantId,
      await this.withPurchaseTaxDefaults(tenantId, dto.lines),
    );
    const lines = inputLines.map((l) => ({
      ...computeLine(l, { taxIncluded }),
      productId: l.productId,
      description: l.description,
      unitId: l.unitId,
      unitFactor: l.unitFactor,
    }));
    const totals = computeTotals(lines);
    const { subtotal: _s, taxAmount: _t, totalAmount: _a, ...header } = dto;

    const order = this.orderRepo.create({
      ...header,
      ...totals,
      tenantId,
      orderNumber,
      createdBy: userId,
      status: PurchaseOrderStatus.DRAFT,
      pricesIncludeTax: taxIncluded,
      requisitionId: extra.requisitionId ?? null,
      lines: lines.map(({ taxAmount: _lt, ...l }) => this.lineRepo.create(l)),
    });

    return this.orderRepo.save(order);
  }

  async findAll(tenantId: string): Promise<PurchaseOrder[]> {
    return this.orderRepo.find({
      where: { tenantId },
      relations: ['lines', 'supplier'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'supplier'],
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  /** Marks an RFQ as sent to the vendor. */
  async markSent(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException('Only draft RFQs can be marked as sent');
    }
    order.status = PurchaseOrderStatus.SENT;
    return this.orderRepo.save(order);
  }

  /**
   * Confirms an RFQ. Orders above the tenant approval threshold go to
   * "to_approve" unless the user can approve them (purchasing/po_approval/approve),
   * in which case they are approved and confirmed at once.
   */
  async confirm(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status === PurchaseOrderStatus.TO_APPROVE) {
      throw new ConflictException('The order is waiting for approval');
    }
    if (order.status !== PurchaseOrderStatus.DRAFT && order.status !== PurchaseOrderStatus.SENT) {
      throw new ConflictException('Only draft orders can be confirmed');
    }

    if (!order.approvedBy && (await this.requiresApproval(tenantId, order))) {
      const canApprove = this.rbac
        ? await this.rbac.hasPermission(tenantId, userId, PO_APPROVAL_PERMISSION)
        : false;
      if (!canApprove) {
        order.status = PurchaseOrderStatus.TO_APPROVE;
        order.rejectionReason = null;
        return this.orderRepo.save(order);
      }
      order.approvedBy = userId;
      order.approvedAt = new Date();
    }

    return this.doConfirm(tenantId, userId, order);
  }

  /** Approves an order waiting for approval and confirms it. */
  async approve(tenantId: string, userId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== PurchaseOrderStatus.TO_APPROVE) {
      throw new ConflictException('Only orders waiting for approval can be approved');
    }
    order.approvedBy = userId;
    order.approvedAt = new Date();
    order.rejectionReason = null;
    return this.doConfirm(tenantId, userId, order);
  }

  /** Sends an order waiting for approval back to draft. */
  async reject(tenantId: string, id: string, reason?: string): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== PurchaseOrderStatus.TO_APPROVE) {
      throw new ConflictException('Only orders waiting for approval can be rejected');
    }
    order.status = PurchaseOrderStatus.DRAFT;
    order.rejectionReason = reason || 'Rejected';
    return this.orderRepo.save(order);
  }

  async requiresApproval(tenantId: string, order: PurchaseOrder): Promise<boolean> {
    if (!this.settingsService) return false;
    const settings = await this.settingsService.get(tenantId);
    const threshold = Number(settings.poApprovalThreshold || 0);
    if (!(threshold > 0)) return false;
    const baseTotal = Number(order.totalAmount) * (Number(order.exchangeRate) || 1);
    return baseTotal > threshold + 0.0001;
  }

  private async doConfirm(
    tenantId: string,
    userId: string,
    order: PurchaseOrder,
  ): Promise<PurchaseOrder> {
    order.status = PurchaseOrderStatus.CONFIRMED;
    order.billStatus = PurchaseOrderBillStatus.TO_BILL;
    const saved = await this.orderRepo.save(order);

    this.eventEmitter.emit(
      'purchase.received',
      new PurchaseReceivedEvent(
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
   * Validates a (full or partial) receipt: puts goods in stock and updates
   * their average cost with the purchase price.
   */
  async receive(
    tenantId: string,
    userId: string,
    id: string,
    dto: ReceiveOrderDto = {},
  ): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== PurchaseOrderStatus.CONFIRMED) {
      throw new ConflictException('Only confirmed orders can be received');
    }

    const warehouseId = dto.warehouseId || order.warehouseId;
    const requested = new Map((dto.lines ?? []).map((l) => [l.lineId, Number(l.quantity)]));
    const requestedLots = new Map((dto.lines ?? []).map((l) => [l.lineId, lotsOrUndefined(l.lots)]));
    for (const l of dto.lines ?? []) {
      if (!order.lines.some((line) => line.id === l.lineId)) {
        throw new BadRequestException(`Line ${l.lineId} is not part of order ${order.orderNumber}`);
      }
    }
    let received = 0;

    for (const line of order.lines) {
      const remaining = round(Number(line.quantity) - Number(line.qtyReceived), 4);
      const quantity = dto.lines ? requested.get(line.id) ?? 0 : remaining;
      if (quantity <= 0) continue;
      if (quantity > remaining + 0.0001) {
        throw new BadRequestException('Received quantity exceeds the remaining ordered quantity');
      }

      const stockable = await this.stockService.isStockable(tenantId, line.productId);
      if (stockable) {
        if (!warehouseId) {
          throw new BadRequestException('A warehouse is required to receive stockable products');
        }
        // Net cost per base unit after the line discount, in company currency
        const factor = Number(line.unitFactor || 1);
        const unitCost = round(
          (Number(line.lineTotal) / (Number(line.quantity) * factor)) * Number(order.exchangeRate || 1),
          4,
        );
        const lots = requestedLots.get(line.id);
        await this.stockService.receive(tenantId, userId, {
          productId: line.productId,
          warehouseId,
          quantity: toBaseQty(quantity, factor),
          unitCost,
          referenceType: 'purchase_order',
          referenceId: order.id,
          description: `Receipt ${order.orderNumber}`,
          lots,
        });
        if (lots?.length) line.lots = addLots(line.lots, lots);
      }

      line.qtyReceived = round(Number(line.qtyReceived) + quantity, 4);
      received += quantity;
    }

    if (received === 0) throw new BadRequestException('Nothing to receive');
    await this.lineRepo.save(order.lines);

    if (order.lines.every((l) => Number(l.qtyReceived) >= Number(l.quantity) - 0.0001)) {
      order.status = PurchaseOrderStatus.RECEIVED;
    }
    return this.orderRepo.save(order);
  }

  /**
   * Creates a draft vendor bill for the order. Stockable goods are billed on
   * received quantities and services on ordered quantities (Odoo's default
   * "received quantities" bill control), preventing paying for goods that
   * never arrived.
   */
  async createBill(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreateBillFromOrderDto = {},
  ): Promise<PurchaseInvoice> {
    const order = await this.findById(tenantId, id);
    if (order.status !== PurchaseOrderStatus.CONFIRMED && order.status !== PurchaseOrderStatus.RECEIVED) {
      throw new ConflictException('Only confirmed orders can be billed');
    }

    const products = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(order.lines.map((l) => l.productId))]) },
    });
    const isGoods = new Map(products.map((p) => [p.id, p.type === ProductType.GOODS]));

    const toBill = order.lines
      .map((line) => {
        const basis = isGoods.get(line.productId) ? Number(line.qtyReceived) : Number(line.quantity);
        return { line, quantity: round(basis - Number(line.qtyBilled), 4) };
      })
      .filter((x) => x.quantity > 0);

    if (toBill.length === 0) {
      throw new BadRequestException('Nothing to bill: receive the goods first or the order is fully billed');
    }

    const bill = await this.invoicesService.create(tenantId, userId, {
      supplierId: order.supplierId,
      orderId: order.id,
      date: dto.date || today(),
      supplierReference: dto.supplierReference,
      currencyId: order.currencyId,
      exchangeRate: Number(order.exchangeRate),
      branchId: order.branchId,
      pricesIncludeTax: order.pricesIncludeTax,
      notes: `Bill for ${order.orderNumber}`,
      lines: toBill.map(({ line, quantity }) => ({
        productId: line.productId,
        quantity,
        unitPrice: Number(line.unitPrice),
        discount: round((Number(line.discount) * quantity) / Number(line.quantity), 4),
        taxRate: Number(line.taxRate),
        description: line.description,
        orderLineId: line.id,
        unitId: line.unitId ?? undefined,
        unitFactor: line.unitId ? Number(line.unitFactor) : undefined,
      })),
    });

    for (const { line, quantity } of toBill) {
      line.qtyBilled = round(Number(line.qtyBilled) + quantity, 4);
    }
    await this.lineRepo.save(order.lines);

    order.billStatus = order.lines.every((l) => Number(l.qtyBilled) >= Number(l.quantity) - 0.0001)
      ? PurchaseOrderBillStatus.BILLED
      : PurchaseOrderBillStatus.PARTIAL;
    await this.orderRepo.save(order);

    return dto.post ? this.invoicesService.approve(tenantId, bill.id, userId) : bill;
  }

  async cancel(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new ConflictException('Order is already cancelled');
    }
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new ConflictException('Received orders cannot be cancelled');
    }
    const lines = order.lines ?? [];
    if (lines.some((l) => Number(l.qtyReceived) > 0)) {
      throw new ConflictException('Partially received orders cannot be cancelled; return the goods first');
    }
    if (lines.some((l) => Number(l.qtyBilled) > 0)) {
      throw new ConflictException('Billed orders cannot be cancelled; cancel or refund the bills first');
    }

    order.status = PurchaseOrderStatus.CANCELLED;
    order.billStatus = PurchaseOrderBillStatus.NOTHING;
    return this.orderRepo.save(order);
  }

  /** Lines without a tax rate take the product's default purchase tax rate. */
  private async withPurchaseTaxDefaults<T extends { productId: string; taxRate?: number | null }>(
    tenantId: string,
    lines: T[],
  ): Promise<T[]> {
    const ids = lines.filter((l) => l.taxRate === undefined || l.taxRate === null).map((l) => l.productId);
    if (!ids.length) return lines;
    const products = await this.productRepo.find({ where: { tenantId, id: In([...new Set(ids)]) } });
    return withDefaultTaxRates(lines, new Map(products.map((p) => [p.id, Number(p.purchaseTaxRate ?? 0)])));
  }
}
