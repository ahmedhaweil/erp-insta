import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Stock } from '../entities/stock.entity';
import { StockMovement, StockMovementType } from '../entities/stock-movement.entity';
import { Product, ProductType } from '../entities/product.entity';
import { StockLot } from '../entities/stock-lot.entity';
import { addDays, round, today } from '@shared/utils/document-totals.util';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inventory reports: item card, balances, slow movers, negative stock, reorder. */
@Injectable()
export class InventoryReportsService {
  constructor(
    @InjectRepository(Stock)
    private readonly stockRepo: Repository<Stock>,
    @InjectRepository(StockMovement)
    private readonly movementRepo: Repository<StockMovement>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
  ) {}

  /**
   * Item card / stock ledger (كارت الصنف): opening balance, every movement in
   * the period with running quantity, value and average cost, closing balance.
   * Values use the unit cost stored on each move (receipts at purchase cost,
   * issues at the average cost of the time).
   */
  async itemCard(
    tenantId: string,
    productId: string,
    opts: { warehouseId?: string; from?: string; to?: string } = {},
  ) {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId }, relations: ['unit'] });
    if (!product) throw new NotFoundException('Product not found');
    const to = this.isoDate(opts.to, today());
    const from = this.isoDate(opts.from, `${to.slice(0, 4)}-01-01`);
    if (from > to) throw new BadRequestException('"from" must not be after "to"');
    const start = `${from}T00:00:00.000Z`;
    const end = `${addDays(to, 1)}T00:00:00.000Z`;

    const openingQb = this.movementRepo
      .createQueryBuilder('m')
      .select('COALESCE(SUM(m.quantity), 0)', 'qty')
      .addSelect('COALESCE(SUM(m.quantity * m.unit_cost), 0)', 'value')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.product_id = :productId', { productId })
      .andWhere('m.created_at < :start', { start });
    if (opts.warehouseId) openingQb.andWhere('m.warehouse_id = :wh', { wh: opts.warehouseId });
    const opening = await openingQb.getRawOne<{ qty: string; value: string }>();

    const qb = this.movementRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.warehouse', 'w')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.productId = :productId', { productId })
      .andWhere('m.createdAt >= :start AND m.createdAt < :end', { start, end })
      .orderBy('m.createdAt', 'ASC');
    if (opts.warehouseId) qb.andWhere('m.warehouseId = :wh', { wh: opts.warehouseId });
    const movements = await qb.getMany();

    const openingQty = round(Number(opening?.qty ?? 0), 4);
    const openingValue = round(Number(opening?.value ?? 0), 4);
    let qty = openingQty;
    let value = openingValue;
    let avg = qty !== 0 ? round(value / qty, 4) : Number(product.costPrice || 0);
    let totalIn = 0;
    let totalOut = 0;

    const lines = movements.map((m) => {
      const q = Number(m.quantity);
      const unitCost = Number(m.unitCost);
      const moveValue = round(q * unitCost, 4);
      qty = round(qty + q, 4);
      value = round(value + moveValue, 4);
      if (Math.abs(qty) > 0.00005) avg = round(value / qty, 4);
      if (q > 0) totalIn += q;
      else totalOut -= q;
      return {
        movementId: m.id,
        date: m.createdAt,
        type: m.type,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        description: m.description,
        warehouseId: m.warehouseId,
        warehouseName: m.warehouse?.nameEn || m.warehouse?.nameAr,
        inQty: q > 0 ? q : 0,
        outQty: q < 0 ? -q : 0,
        unitCost,
        value: moveValue,
        balanceQty: qty,
        balanceValue: value,
        averageCost: avg,
      };
    });

    return {
      product: {
        id: product.id,
        code: product.code,
        name: product.nameEn || product.nameAr,
        unit: product.unit?.nameEn || product.unit?.nameAr,
        currentAverageCost: Number(product.costPrice || 0),
      },
      warehouseId: opts.warehouseId ?? null,
      from,
      to,
      opening: { quantity: openingQty, value: openingValue, averageCost: openingQty ? round(openingValue / openingQty, 4) : 0 },
      lines,
      totals: { inQty: round(totalIn, 4), outQty: round(totalOut, 4) },
      closing: { quantity: qty, value, averageCost: qty ? round(value / qty, 4) : 0 },
    };
  }

  /** Stock on hand by warehouse with value at average cost. */
  async stockBalance(tenantId: string, opts: { warehouseId?: string; categoryId?: string; includeZero?: boolean } = {}) {
    const qb = this.stockRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.product', 'p')
      .innerJoinAndSelect('s.warehouse', 'w')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('w.code', 'ASC')
      .addOrderBy('p.code', 'ASC');
    if (opts.warehouseId) qb.andWhere('s.warehouseId = :wh', { wh: opts.warehouseId });
    if (opts.categoryId) qb.andWhere('p.categoryId = :cat', { cat: opts.categoryId });
    if (!opts.includeZero) qb.andWhere('s.quantity <> 0');
    const stocks = await qb.getMany();

    const byWarehouse = new Map<string, any>();
    for (const s of stocks) {
      let group = byWarehouse.get(s.warehouseId);
      if (!group) {
        group = {
          warehouseId: s.warehouseId,
          warehouseCode: s.warehouse.code,
          warehouseName: s.warehouse.nameEn || s.warehouse.nameAr,
          branchId: s.warehouse.branchId,
          lines: [],
          totalQty: 0,
          totalValue: 0,
        };
        byWarehouse.set(s.warehouseId, group);
      }
      const quantity = Number(s.quantity);
      const unitCost = Number(s.product.costPrice || 0);
      const value = round(quantity * unitCost, 4);
      group.lines.push({
        productId: s.productId,
        productCode: s.product.code,
        productName: s.product.nameEn || s.product.nameAr,
        quantity,
        reservedQty: Number(s.reservedQty),
        availableQty: round(quantity - Number(s.reservedQty), 4),
        unitCost,
        value,
      });
      group.totalQty = round(group.totalQty + quantity, 4);
      group.totalValue = round(group.totalValue + value, 4);
    }
    const warehouses = [...byWarehouse.values()];
    return { warehouses, totalValue: round(warehouses.reduce((s, w) => s + w.totalValue, 0), 4) };
  }

  /**
   * Items in stock with no issue (sale/consumption) in the last `days` days;
   * `noMovement` marks items with no movement at all in that period.
   */
  async slowMoving(tenantId: string, opts: { days?: number; warehouseId?: string } = {}) {
    const days = Math.max(Number(opts.days) || 90, 1);
    const since = `${addDays(today(), -days)}T00:00:00.000Z`;

    const statsQb = this.movementRepo
      .createQueryBuilder('m')
      .select('m.product_id', 'productId')
      .addSelect('m.warehouse_id', 'warehouseId')
      .addSelect('MAX(m.created_at)', 'lastMovementAt')
      .addSelect(`MAX(CASE WHEN m.type = :out THEN m.created_at END)`, 'lastIssueAt')
      .addSelect(
        `COALESCE(SUM(CASE WHEN m.type = :out AND m.created_at >= :since THEN -m.quantity ELSE 0 END), 0)`,
        'issuedQty',
      )
      .where('m.tenant_id = :tenantId', { tenantId, out: StockMovementType.OUT, since })
      .groupBy('m.product_id')
      .addGroupBy('m.warehouse_id');
    if (opts.warehouseId) statsQb.andWhere('m.warehouse_id = :wh', { wh: opts.warehouseId });
    const stats = await statsQb.getRawMany<{
      productId: string;
      warehouseId: string;
      lastMovementAt: Date | null;
      lastIssueAt: Date | null;
      issuedQty: string;
    }>();
    const statMap = new Map(stats.map((s) => [`${s.productId}|${s.warehouseId}`, s]));

    const stockQb = this.stockRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.product', 'p')
      .innerJoinAndSelect('s.warehouse', 'w')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.quantity > 0');
    if (opts.warehouseId) stockQb.andWhere('s.warehouseId = :wh', { wh: opts.warehouseId });
    const stocks = await stockQb.getMany();

    const sinceMs = Date.parse(since);
    const lines = stocks
      .map((s) => {
        const st = statMap.get(`${s.productId}|${s.warehouseId}`);
        const issuedQty = Number(st?.issuedQty ?? 0);
        const lastMovementAt = st?.lastMovementAt ? new Date(st.lastMovementAt) : null;
        const lastIssueAt = st?.lastIssueAt ? new Date(st.lastIssueAt) : null;
        const quantity = Number(s.quantity);
        const unitCost = Number(s.product.costPrice || 0);
        return {
          productId: s.productId,
          productCode: s.product.code,
          productName: s.product.nameEn || s.product.nameAr,
          warehouseId: s.warehouseId,
          warehouseName: s.warehouse.nameEn || s.warehouse.nameAr,
          quantity,
          value: round(quantity * unitCost, 4),
          issuedQty,
          lastIssueAt,
          lastMovementAt,
          daysSinceLastIssue: lastIssueAt ? Math.floor((Date.now() - lastIssueAt.getTime()) / 86400000) : null,
          noMovement: !lastMovementAt || lastMovementAt.getTime() < sinceMs,
        };
      })
      .filter((l) => l.issuedQty <= 0)
      .sort((a, b) => b.value - a.value);
    return { days, since: since.slice(0, 10), lines, totalValue: round(lines.reduce((s, l) => s + l.value, 0), 4) };
  }

  /**
   * Integrity check: negative on-hand quantities, and lots holding more than
   * the warehouse quantity.
   */
  async negativeStock(tenantId: string, warehouseId?: string) {
    const qb = this.stockRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.product', 'p')
      .innerJoinAndSelect('s.warehouse', 'w')
      .where('s.tenantId = :tenantId', { tenantId })
      .andWhere('s.quantity < 0');
    if (warehouseId) qb.andWhere('s.warehouseId = :wh', { wh: warehouseId });
    const negatives = (await qb.getMany()).map((s) => ({
      productId: s.productId,
      productCode: s.product.code,
      productName: s.product.nameEn || s.product.nameAr,
      warehouseId: s.warehouseId,
      warehouseName: s.warehouse.nameEn || s.warehouse.nameAr,
      quantity: Number(s.quantity),
      value: round(Number(s.quantity) * Number(s.product.costPrice || 0), 4),
    }));

    const lotQb = this.lotRepo
      .createQueryBuilder('l')
      .select('l.product_id', 'productId')
      .addSelect('l.warehouse_id', 'warehouseId')
      .addSelect('SUM(l.quantity)', 'lotQty')
      .addSelect('MAX(s.quantity)', 'stockQty')
      .leftJoin(
        Stock,
        's',
        's.tenant_id = l.tenant_id AND s.product_id = l.product_id AND s.warehouse_id = l.warehouse_id',
      )
      .where('l.tenant_id = :tenantId', { tenantId })
      .groupBy('l.product_id')
      .addGroupBy('l.warehouse_id')
      .having('SUM(l.quantity) > COALESCE(MAX(s.quantity), 0) + 0.0001');
    if (warehouseId) lotQb.andWhere('l.warehouse_id = :wh', { wh: warehouseId });
    const lotMismatches = (await lotQb.getRawMany()).map((r) => ({
      productId: r.productId,
      warehouseId: r.warehouseId,
      lotQty: Number(r.lotQty),
      stockQty: Number(r.stockQty ?? 0),
    }));
    return { negatives, lotMismatches, count: negatives.length + lotMismatches.length };
  }

  /**
   * Reorder report: goods whose available quantity (on hand - reserved) is at
   * or below the reorder level, with a suggested order quantity. Incoming
   * purchase orders are not deducted (see purchasing replenishment for that).
   */
  async reorder(tenantId: string, warehouseId?: string) {
    const products = await this.productRepo.find({
      where: { tenantId, type: ProductType.GOODS, isActive: true },
      order: { code: 'ASC' },
    });
    const stockWhere: any = { tenantId };
    if (warehouseId) stockWhere.warehouseId = warehouseId;
    const stocks = await this.stockRepo.find({ where: stockWhere });
    const totals = new Map<string, { onHand: number; reserved: number }>();
    for (const s of stocks) {
      const t = totals.get(s.productId) ?? { onHand: 0, reserved: 0 };
      t.onHand += Number(s.quantity);
      t.reserved += Number(s.reservedQty);
      totals.set(s.productId, t);
    }
    const lines = products
      .filter((p) => Number(p.reorderLevel) > 0)
      .map((p) => {
        const t = totals.get(p.id) ?? { onHand: 0, reserved: 0 };
        const available = round(t.onHand - t.reserved, 4);
        const reorderLevel = Number(p.reorderLevel);
        const suggestedQty = round(Math.max(Number(p.reorderQty || 0), reorderLevel - available), 4);
        return {
          productId: p.id,
          productCode: p.code,
          productName: p.nameEn || p.nameAr,
          onHand: round(t.onHand, 4),
          reserved: round(t.reserved, 4),
          available,
          reorderLevel,
          reorderQty: Number(p.reorderQty || 0),
          suggestedQty,
          estimatedCost: round(suggestedQty * Number(p.costPrice || 0), 4),
          preferredSupplierId: p.preferredSupplierId ?? null,
        };
      })
      .filter((l) => l.available <= l.reorderLevel);
    return { warehouseId: warehouseId ?? null, lines };
  }

  private isoDate(value: string | undefined, fallback: string): string {
    if (!value) return fallback;
    if (!ISO_DATE.test(value)) throw new BadRequestException(`Invalid date ${value} (expected YYYY-MM-DD)`);
    return value;
  }
}
