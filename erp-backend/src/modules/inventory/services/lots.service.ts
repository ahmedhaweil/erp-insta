import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository, Between } from 'typeorm';
import { StockLot } from '../entities/stock-lot.entity';
import { StockLotMovement } from '../entities/stock-lot-movement.entity';
import { Product, TrackingType } from '../entities/product.entity';
import { addDays, round, today } from '@shared/utils/document-totals.util';

const EPS = 0.00005;

/** A lot quantity given by a caller (receipt, issue, transfer, count). */
export interface StockLotInput {
  lotNumber: string;
  quantity: number;
  expiryDate?: string | null;
}

/** A lot quantity actually moved. */
export interface LotAllocation {
  lotNumber: string;
  quantity: number;
  expiryDate: string | null;
}

export interface LotMoveContext {
  tenantId: string;
  userId?: string;
  productId: string;
  warehouseId: string;
  referenceType?: string;
  referenceId?: string;
  movementId?: string;
}

export interface ConsumeOptions {
  /** Explicit lots to take; FEFO when omitted. */
  lots?: StockLotInput[];
  /** FEFO may pick expired lots (write-offs, transfers). Default false. */
  includeExpired?: boolean;
  /** Warehouse on-hand quantity before the move (lots + untracked). */
  onHand: number;
  /** Negative stock allowed: an uncovered remainder is not an error. */
  allowShortage?: boolean;
}

export function isTracked(product: Pick<Product, 'trackingType'>): boolean {
  return !!product.trackingType && product.trackingType !== TrackingType.NONE;
}

/** FEFO order: earliest expiry first, lots without expiry last, then oldest receipt. */
export function fefoSort<T extends { expiryDate: string | null; receivedDate?: string; createdAt?: Date }>(
  lots: T[],
): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) {
      if (!a.expiryDate) return 1;
      if (!b.expiryDate) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    }
    const ra = a.receivedDate ?? '';
    const rb = b.receivedDate ?? '';
    if (ra !== rb) return ra < rb ? -1 : 1;
    return (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0);
  });
}

/**
 * Lots, batches and serial numbers (Odoo stock.lot). Quantities per lot are
 * kept in `stock_lots`, every lot change is journaled in `stock_lot_movements`
 * for traceability. Called by StockService inside its stock moves.
 */
@Injectable()
export class LotsService {
  constructor(
    @InjectRepository(StockLot)
    private readonly lotRepo: Repository<StockLot>,
    @InjectRepository(StockLotMovement)
    private readonly lotMoveRepo: Repository<StockLotMovement>,
  ) {}

  /**
   * Validates and normalises the lots of an incoming move. Untracked products
   * reject lots. Tracked products without lots are rejected when `strict`,
   * otherwise get an automatic lot (or serial numbers) named `fallbackName`.
   */
  prepareIncoming(
    product: Product,
    quantity: number,
    lots: StockLotInput[] | undefined,
    opts: { strict: boolean; fallbackName: string },
  ): LotAllocation[] {
    if (!isTracked(product)) {
      if (lots?.length) {
        throw new BadRequestException(`Product ${product.code} is not tracked by lot/serial number`);
      }
      return [];
    }
    const serial = product.trackingType === TrackingType.SERIAL;

    if (!lots?.length) {
      if (opts.strict) {
        throw new BadRequestException(
          `${serial ? 'Serial' : 'Lot'} numbers are required for product ${product.code}`,
        );
      }
      const name = (opts.fallbackName || 'AUTO').slice(0, 80);
      if (!serial) return [{ lotNumber: name, quantity, expiryDate: null }];
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException(`Serial-tracked product ${product.code} needs a whole quantity`);
      }
      return Array.from({ length: quantity }, (_, i) => ({
        lotNumber: `${name}-${String(i + 1).padStart(3, '0')}`,
        quantity: 1,
        expiryDate: null,
      }));
    }

    const merged = this.normalise(product, lots);
    if (opts.strict && product.hasExpiry) {
      const missing = merged.find((l) => !l.expiryDate);
      if (missing) {
        throw new BadRequestException(`Expiry date is required for lot ${missing.lotNumber} of ${product.code}`);
      }
    }
    this.assertTotal(product, merged, quantity);
    return merged;
  }

  /** Adds incoming quantities to lots of a warehouse (creating them as needed). */
  async addLots(ctx: LotMoveContext, product: Product, allocations: LotAllocation[], unitCost = 0): Promise<StockLot[]> {
    const saved: StockLot[] = [];
    for (const a of allocations) {
      if (product.trackingType === TrackingType.SERIAL) {
        const inStock = await this.lotRepo.findOne({
          where: { tenantId: ctx.tenantId, productId: ctx.productId, lotNumber: a.lotNumber, quantity: MoreThan(0) },
        });
        if (inStock) {
          throw new ConflictException(`Serial number ${a.lotNumber} of ${product.code} is already in stock`);
        }
      }
      let lot = await this.lotRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          productId: ctx.productId,
          warehouseId: ctx.warehouseId,
          lotNumber: a.lotNumber,
        },
      });
      if (!lot) {
        lot = this.lotRepo.create({
          tenantId: ctx.tenantId,
          productId: ctx.productId,
          warehouseId: ctx.warehouseId,
          lotNumber: a.lotNumber,
          expiryDate: a.expiryDate ?? null,
          quantity: 0,
          unitCost: round(Number(unitCost || 0), 4),
          receivedDate: today(),
        });
      } else if (a.expiryDate && lot.expiryDate && lot.expiryDate !== a.expiryDate) {
        throw new BadRequestException(
          `Lot ${a.lotNumber} of ${product.code} already exists with expiry ${lot.expiryDate}`,
        );
      } else if (a.expiryDate && !lot.expiryDate) {
        lot.expiryDate = a.expiryDate;
      }
      lot.quantity = round(Number(lot.quantity) + a.quantity, 4);
      const savedLot = await this.lotRepo.save(lot);
      a.expiryDate = savedLot.expiryDate ?? null;
      await this.record(ctx, savedLot, a.quantity);
      saved.push(savedLot);
    }
    return saved;
  }

  /**
   * Takes `quantity` out of the lots of a warehouse: the given lots, or FEFO
   * (expired lots skipped unless `includeExpired`). Stock not covered by any
   * lot (received before tracking was enabled) is used after the lots.
   * Returns the lot quantities taken.
   */
  async consume(ctx: LotMoveContext, product: Product, quantity: number, opts: ConsumeOptions): Promise<LotAllocation[]> {
    if (!isTracked(product)) {
      if (opts.lots?.length) {
        throw new BadRequestException(`Product ${product.code} is not tracked by lot/serial number`);
      }
      return [];
    }
    const taken: LotAllocation[] = [];

    if (opts.lots?.length) {
      const requested = this.normalise(product, opts.lots);
      this.assertTotal(product, requested, quantity);
      for (const r of requested) {
        const lot = await this.lotRepo.findOne({
          where: {
            tenantId: ctx.tenantId,
            productId: ctx.productId,
            warehouseId: ctx.warehouseId,
            lotNumber: r.lotNumber,
          },
        });
        const available = Number(lot?.quantity ?? 0);
        if (!lot || available + EPS < r.quantity) {
          throw new BadRequestException(
            `Lot ${r.lotNumber} of ${product.code} has ${round(available, 4)} available, ${r.quantity} requested`,
          );
        }
        taken.push(await this.take(ctx, lot, r.quantity));
      }
      return taken;
    }

    const lots = await this.lotRepo.find({
      where: { tenantId: ctx.tenantId, productId: ctx.productId, warehouseId: ctx.warehouseId, quantity: MoreThan(0) },
    });
    const lotted = lots.reduce((s, l) => s + Number(l.quantity), 0);
    const untracked = Math.max(round(Number(opts.onHand) - lotted, 4), 0);
    const now = today();
    const usable = fefoSort(lots).filter((l) => opts.includeExpired || !l.expiryDate || l.expiryDate >= now);

    let remaining = quantity;
    for (const lot of usable) {
      if (remaining <= EPS) break;
      const qty = Math.min(Number(lot.quantity), remaining);
      taken.push(await this.take(ctx, lot, round(qty, 4)));
      remaining = round(remaining - qty, 4);
    }
    remaining = round(remaining - Math.min(untracked, remaining), 4);

    if (remaining > EPS && !opts.allowShortage) {
      const expired = lots
        .filter((l) => !usable.includes(l))
        .reduce((s, l) => s + Number(l.quantity), 0);
      throw new BadRequestException(
        `Insufficient lot stock for ${product.code}: missing ${remaining}` +
          (expired > 0 ? ` (${round(expired, 4)} in expired lots, which are not issued automatically)` : ''),
      );
    }
    return taken;
  }

  /** Sum of lot quantities of a product in a warehouse. */
  async lottedQuantity(tenantId: string, productId: string, warehouseId: string): Promise<number> {
    const lots = await this.lotRepo.find({ where: { tenantId, productId, warehouseId } });
    return round(lots.reduce((s, l) => s + Number(l.quantity), 0), 4);
  }

  findLots(tenantId: string, filter: { productId?: string; warehouseId?: string; includeEmpty?: boolean }) {
    const where: any = { tenantId };
    if (filter.productId) where.productId = filter.productId;
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (!filter.includeEmpty) where.quantity = MoreThan(0);
    return this.lotRepo
      .find({ where, relations: ['product', 'warehouse'] })
      .then((lots) => fefoSort(lots).map((l) => this.present(l)));
  }

  /** Lots with stock expiring within `days` days (today included). */
  async expiring(tenantId: string, days: number, warehouseId?: string) {
    const from = today();
    const to = addDays(from, Math.max(Number(days) || 0, 0));
    const where: any = { tenantId, quantity: MoreThan(0), expiryDate: Between(from, to) };
    if (warehouseId) where.warehouseId = warehouseId;
    const lots = await this.lotRepo.find({ where, relations: ['product', 'warehouse'] });
    const lines = fefoSort(lots).map((l) => this.present(l));
    return { from, to, lines, totalValue: round(lines.reduce((s, l) => s + l.value, 0), 4) };
  }

  /** Expired lots still in stock, valued at the product's current average cost. */
  async expired(tenantId: string, warehouseId?: string) {
    const where: any = { tenantId, quantity: MoreThan(0), expiryDate: LessThan(today()) };
    if (warehouseId) where.warehouseId = warehouseId;
    const lots = await this.lotRepo.find({ where, relations: ['product', 'warehouse'] });
    const lines = fefoSort(lots).map((l) => this.present(l));
    return { asOf: today(), lines, totalValue: round(lines.reduce((s, l) => s + l.value, 0), 4) };
  }

  /**
   * Lot traceability: every movement of a lot/serial number across
   * warehouses (origin receipt, transfers, sales...) and its current balances.
   */
  async trace(tenantId: string, productId: string, lotNumber: string) {
    const movements = await this.lotMoveRepo.find({
      where: { tenantId, productId, lotNumber },
      order: { createdAt: 'ASC' },
    });
    const balances = await this.lotRepo.find({
      where: { tenantId, productId, lotNumber },
      relations: ['warehouse'],
    });
    return {
      productId,
      lotNumber,
      expiryDate: balances.find((b) => b.expiryDate)?.expiryDate ?? null,
      origin: movements.find((m) => Number(m.quantity) > 0) ?? null,
      movements: movements.map((m) => ({
        date: m.createdAt,
        warehouseId: m.warehouseId,
        quantity: Number(m.quantity),
        direction: Number(m.quantity) >= 0 ? 'in' : 'out',
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        movementId: m.movementId,
      })),
      balances: balances.map((b) => ({
        warehouseId: b.warehouseId,
        warehouseName: b.warehouse?.nameEn || b.warehouse?.nameAr,
        quantity: Number(b.quantity),
      })),
      totalOnHand: round(balances.reduce((s, b) => s + Number(b.quantity), 0), 4),
    };
  }

  /** Lots of several products in one warehouse (used by stocktaking). */
  findWarehouseLots(tenantId: string, warehouseId: string, productIds: string[]) {
    if (!productIds.length) return Promise.resolve([] as StockLot[]);
    return this.lotRepo.find({
      where: { tenantId, warehouseId, productId: In(productIds), quantity: MoreThan(0) },
    });
  }

  private present(l: StockLot) {
    const quantity = Number(l.quantity);
    const unitCost = Number(l.product?.costPrice ?? 0);
    const now = today();
    return {
      id: l.id,
      productId: l.productId,
      productCode: l.product?.code,
      productName: l.product?.nameEn || l.product?.nameAr,
      warehouseId: l.warehouseId,
      warehouseName: l.warehouse?.nameEn || l.warehouse?.nameAr,
      lotNumber: l.lotNumber,
      expiryDate: l.expiryDate,
      daysToExpiry: l.expiryDate
        ? Math.round((Date.parse(l.expiryDate) - Date.parse(now)) / 86400000)
        : null,
      quantity,
      unitCost,
      value: round(quantity * unitCost, 4),
    };
  }

  private async take(ctx: LotMoveContext, lot: StockLot, quantity: number): Promise<LotAllocation> {
    lot.quantity = round(Number(lot.quantity) - quantity, 4);
    await this.lotRepo.save(lot);
    await this.record(ctx, lot, -quantity);
    return { lotNumber: lot.lotNumber, quantity, expiryDate: lot.expiryDate ?? null };
  }

  private async record(ctx: LotMoveContext, lot: StockLot, quantity: number): Promise<void> {
    await this.lotMoveRepo.save(
      this.lotMoveRepo.create({
        tenantId: ctx.tenantId,
        lotId: lot.id,
        productId: ctx.productId,
        warehouseId: ctx.warehouseId,
        lotNumber: lot.lotNumber,
        expiryDate: lot.expiryDate ?? null,
        quantity,
        movementId: ctx.movementId,
        referenceType: ctx.referenceType,
        referenceId: ctx.referenceId,
        createdBy: ctx.userId,
      }),
    );
  }

  /** Trims, merges duplicate lots and enforces serial rules (qty 1, unique). */
  private normalise(product: Product, lots: StockLotInput[]): LotAllocation[] {
    const serial = product.trackingType === TrackingType.SERIAL;
    const merged = new Map<string, LotAllocation>();
    for (const l of lots) {
      const lotNumber = String(l.lotNumber ?? '').trim();
      const quantity = Number(l.quantity);
      if (!lotNumber) throw new BadRequestException(`Lot number is required for ${product.code}`);
      if (!(quantity > 0)) throw new BadRequestException(`Lot ${lotNumber} quantity must be positive`);
      if (serial && Math.abs(quantity - 1) > EPS) {
        throw new BadRequestException(`Serial number ${lotNumber} must have quantity 1`);
      }
      const existing = merged.get(lotNumber);
      if (existing) {
        if (serial) throw new BadRequestException(`Serial number ${lotNumber} is duplicated`);
        existing.quantity = round(existing.quantity + quantity, 4);
        existing.expiryDate = existing.expiryDate ?? l.expiryDate ?? null;
      } else {
        merged.set(lotNumber, { lotNumber, quantity, expiryDate: l.expiryDate ?? null });
      }
    }
    return [...merged.values()];
  }

  private assertTotal(product: Product, lots: LotAllocation[], quantity: number): void {
    const total = round(lots.reduce((s, l) => s + l.quantity, 0), 4);
    if (Math.abs(total - quantity) > EPS) {
      throw new BadRequestException(
        `Lot quantities of ${product.code} (${total}) must equal the moved quantity (${quantity})`,
      );
    }
  }
}
