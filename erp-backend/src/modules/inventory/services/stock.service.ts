import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Stock } from '../entities/stock.entity';
import { StockMovement, StockMovementType } from '../entities/stock-movement.entity';
import { Product, ProductType } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { StockAdjustmentDto } from '../dto/stock-adjustment.dto';
import { StockTransferDto } from '../dto/stock-transfer.dto';
import { StockAdjustedEvent } from '../events/stock-adjusted.event';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { round, today } from '@shared/utils/document-totals.util';
import { LotAllocation, LotsService, StockLotInput } from './lots.service';
import { InventorySettingsService } from './inventory-settings.service';
import { ProductsService } from './products.service';

export type { StockLotInput, LotAllocation } from './lots.service';

const EPS = 0.00005;

export interface StockMoveRequest {
  productId: string;
  warehouseId: string;
  quantity: number;
  referenceType: string;
  referenceId?: string;
  description?: string;
  /**
   * Optional lots/serial numbers moved. Receipts of tracked products without
   * lots get an automatic lot named after the reference; issues without lots
   * consume lots first-expiry-first-out.
   */
  lots?: StockLotInput[];
}

export interface StockReceiptRequest extends StockMoveRequest {
  /** Purchase unit cost, used for average-cost (AVCO) valuation. */
  unitCost: number;
}

export interface StockIssueRequest extends StockMoveRequest {
  /** Quantity previously reserved for this document that the issue consumes. */
  releaseReserved?: number;
}

export interface StockReceiveOptions {
  /** Reject tracked products without lots (explicit lot APIs). */
  strictLots?: boolean;
  /** Movement type recorded (default IN). */
  movementType?: StockMovementType;
  /** Already validated lot quantities (e.g. lots shipped by a transfer). */
  lotAllocations?: LotAllocation[];
  /** Recompute the average cost (default true). */
  updateAverageCost?: boolean;
}

export interface StockIssueOptions {
  /** Movement type recorded (default OUT). */
  movementType?: StockMovementType;
  /** FEFO may pick expired lots (default false: expired lots are not sold). */
  includeExpiredLots?: boolean;
}

export interface StockAdjustOptions {
  /** Post the inventory gain/loss entry (default true). */
  post?: boolean;
  referenceType?: string;
  referenceId?: string;
  /**
   * Adjust only the untracked part of a tracked product's stock (stock not
   * covered by any lot): lots are left untouched.
   */
  untrackedOnly?: boolean;
}

export interface StockIssueResult {
  unitCost: number;
  cost: number;
  /** Lots/serial numbers consumed (empty for untracked products). */
  lots: LotAllocation[];
}

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(Stock)
    private readonly stockRepo: Repository<Stock>,
    @InjectRepository(StockMovement)
    private readonly movementRepo: Repository<StockMovement>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly eventEmitter: EventEmitter2,
    private readonly autoPosting: AutoPostingService,
    private readonly lotsService: LotsService,
    private readonly settings: InventorySettingsService,
    private readonly productsService: ProductsService,
  ) {}

  async getStock(tenantId: string, productId?: string, warehouseId?: string): Promise<Stock[]> {
    const where: any = { tenantId };
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;

    return this.stockRepo.find({
      where,
      relations: ['product', 'warehouse'],
      order: { createdAt: 'DESC' },
    });
  }

  async getMovements(tenantId: string, productId?: string, warehouseId?: string) {
    const where: any = { tenantId };
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;
    return this.movementRepo.find({ where, order: { createdAt: 'DESC' }, take: 500 });
  }

  /**
   * Inventory adjustment (positive = gain, negative = loss) posted to the
   * stock adjustment account at the current average cost.
   */
  async adjust(
    tenantId: string,
    userId: string,
    dto: StockAdjustmentDto,
    options: StockAdjustOptions = {},
  ): Promise<Stock> {
    const product = await this.productRepo.findOne({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.type === ProductType.SERVICE) {
      throw new BadRequestException('Services are not stockable');
    }
    const quantity = Number(dto.quantity);
    if (!quantity) throw new BadRequestException('Adjustment quantity cannot be zero');

    const warehouse = await this.warehouseRepo.findOne({
      where: { id: dto.warehouseId, tenantId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const stock = await this.findOrCreateStock(tenantId, dto.productId, dto.warehouseId);
    const onHand = Number(stock.quantity);
    const newQty = round(onHand + quantity, 4);
    if (newQty < -EPS || newQty < Number(stock.reservedQty) - EPS) {
      if (!(await this.settings.allowNegativeStock(tenantId))) {
        throw new BadRequestException(
          newQty < 0
            ? 'Adjustment would result in negative stock'
            : 'Adjustment would leave less stock than is reserved',
        );
      }
    }
    if (options.untrackedOnly && quantity < 0) {
      const lotted = await this.lotsService.lottedQuantity(tenantId, dto.productId, dto.warehouseId);
      if (round(onHand - lotted, 4) + quantity < -EPS) {
        throw new BadRequestException('Adjustment exceeds the stock not assigned to any lot');
      }
    }
    const allocations =
      quantity > 0 && !options.untrackedOnly
        ? this.lotsService.prepareIncoming(product, quantity, dto.lots, {
            strict: false,
            fallbackName: `ADJ-${today()}`,
          })
        : [];

    const unitCost = Number(product.costPrice || 0);
    const post = options.post !== false;
    if (post && unitCost > 0) {
      await this.autoPosting.preflight(tenantId, today(), ['inventoryAccountId', 'stockAdjustmentAccountId']);
    }

    stock.quantity = newQty;
    const saved = await this.stockRepo.save(stock);

    const movement = await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        type: StockMovementType.ADJUSTMENT,
        quantity,
        unitCost,
        referenceType: options.referenceType ?? 'adjustment',
        referenceId: options.referenceId,
        createdBy: userId,
        description: dto.reason,
      }),
    );

    const lotCtx = {
      tenantId,
      userId,
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      referenceType: options.referenceType ?? 'adjustment',
      referenceId: options.referenceId,
      movementId: movement?.id,
    };
    if (options.untrackedOnly) {
      // lots unchanged: the untracked remainder (stock - lots) absorbs the change
    } else if (quantity > 0) {
      await this.lotsService.addLots(lotCtx, product, allocations, unitCost);
    } else {
      await this.lotsService.consume(lotCtx, product, -quantity, {
        lots: dto.lots,
        includeExpired: true,
        onHand,
        allowShortage: true,
      });
    }

    // Inventory gain/loss valuation entry (Odoo inventory adjustment posting)
    const value = round(Math.abs(quantity) * unitCost, 4);
    if (post && value > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: today(),
        description: `Inventory adjustment ${product.code}${dto.reason ? ` - ${dto.reason}` : ''}`,
        sourceType: 'stock_adjustment',
        sourceId: movement?.id ?? saved.id,
        buildLines: (_s, account) =>
          quantity > 0
            ? [
                { accountId: account('inventoryAccountId'), debit: value },
                { accountId: account('stockAdjustmentAccountId'), credit: value },
              ]
            : [
                { accountId: account('stockAdjustmentAccountId'), debit: value },
                { accountId: account('inventoryAccountId'), credit: value },
              ],
      });
    }

    this.eventEmitter.emit(
      'stock.adjusted',
      new StockAdjustedEvent(
        tenantId,
        userId,
        dto.productId,
        dto.warehouseId,
        quantity,
        StockMovementType.ADJUSTMENT,
      ),
    );

    return saved;
  }

  /**
   * Immediate warehouse-to-warehouse move of one product at the current
   * average cost (no accounting impact). Lots move along (FEFO unless given).
   * For multi-line, two-step transfers use the transfer documents.
   */
  async transfer(
    tenantId: string,
    userId: string,
    dto: StockTransferDto,
  ): Promise<{ from: Stock; to: Stock }> {
    if (!(dto.quantity > 0)) {
      throw new BadRequestException('Transfer quantity must be positive');
    }

    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    const product = await this.productRepo.findOne({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.type === ProductType.SERVICE) {
      throw new BadRequestException('Services are not stockable');
    }

    const fromWarehouse = await this.warehouseRepo.findOne({
      where: { id: dto.fromWarehouseId, tenantId },
    });
    if (!fromWarehouse) throw new NotFoundException('Source warehouse not found');

    const toWarehouse = await this.warehouseRepo.findOne({
      where: { id: dto.toWarehouseId, tenantId },
    });
    if (!toWarehouse) throw new NotFoundException('Destination warehouse not found');

    let fromStock = await this.stockRepo.findOne({
      where: { tenantId, productId: dto.productId, warehouseId: dto.fromWarehouseId },
    });
    const allowNegative = async () => this.settings.allowNegativeStock(tenantId);
    if (!fromStock) {
      if (!(await allowNegative())) throw new NotFoundException('No stock found in source warehouse');
      fromStock = this.stockRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.fromWarehouseId,
        quantity: 0,
        reservedQty: 0,
      });
    }

    const onHand = Number(fromStock.quantity);
    const availableQty = onHand - Number(fromStock.reservedQty);
    const short = availableQty + EPS < dto.quantity;
    if (short && !(await allowNegative())) {
      throw new BadRequestException('Insufficient available stock in source warehouse');
    }

    fromStock.quantity = round(onHand - dto.quantity, 4);
    await this.stockRepo.save(fromStock);

    let toStock = await this.stockRepo.findOne({
      where: { tenantId, productId: dto.productId, warehouseId: dto.toWarehouseId },
    });
    if (!toStock) {
      toStock = this.stockRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.toWarehouseId,
        quantity: 0,
        reservedQty: 0,
      });
    }
    toStock.quantity = round(Number(toStock.quantity) + dto.quantity, 4);
    await this.stockRepo.save(toStock);

    const unitCost = Number(product.costPrice || 0);
    const [outMove, inMove] = (await this.movementRepo.save([
      this.movementRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.fromWarehouseId,
        type: StockMovementType.TRANSFER,
        quantity: -dto.quantity,
        unitCost,
        referenceType: 'transfer',
        createdBy: userId,
        description: `Transfer to ${toWarehouse.nameEn || toWarehouse.nameAr}`,
      }),
      this.movementRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.toWarehouseId,
        type: StockMovementType.TRANSFER,
        quantity: dto.quantity,
        unitCost,
        referenceType: 'transfer',
        createdBy: userId,
        description: `Transfer from ${fromWarehouse.nameEn || fromWarehouse.nameAr}`,
      }),
    ])) as unknown as StockMovement[];

    const moved = await this.lotsService.consume(
      {
        tenantId,
        userId,
        productId: dto.productId,
        warehouseId: dto.fromWarehouseId,
        referenceType: 'transfer',
        movementId: outMove?.id,
      },
      product,
      dto.quantity,
      { lots: dto.lots, includeExpired: false, onHand, allowShortage: short },
    );
    await this.lotsService.addLots(
      {
        tenantId,
        userId,
        productId: dto.productId,
        warehouseId: dto.toWarehouseId,
        referenceType: 'transfer',
        movementId: inMove?.id,
      },
      product,
      moved,
      unitCost,
    );

    return { from: fromStock, to: toStock };
  }

  /**
   * Goods receipt (Odoo incoming picking validation). Increases on-hand stock
   * and recomputes the product's average cost.
   */
  async receive(
    tenantId: string,
    userId: string,
    req: StockReceiptRequest,
    options: StockReceiveOptions = {},
  ): Promise<Stock | null> {
    if (!(req.quantity > 0)) throw new BadRequestException('Received quantity must be positive');
    const product = await this.getStockableProduct(tenantId, req.productId);
    if (!product) return null;
    await this.assertWarehouse(tenantId, req.warehouseId);

    // Validate lots before anything is changed
    const allocations =
      options.lotAllocations ??
      this.lotsService.prepareIncoming(product, req.quantity, req.lots, {
        strict: options.strictLots === true,
        fallbackName: this.fallbackLotName(req),
      });

    // AVCO: new cost = (on-hand value + received value) / (on-hand qty + received qty)
    if (options.updateAverageCost !== false) {
      const onHand = await this.totalOnHand(tenantId, req.productId);
      const currentCost = Number(product.costPrice || 0);
      const newQty = onHand + req.quantity;
      if (newQty > 0) {
        product.costPrice = round(
          (Math.max(onHand, 0) * currentCost + req.quantity * Number(req.unitCost)) /
            (Math.max(onHand, 0) + req.quantity),
          4,
        );
        await this.productRepo.save(product);
      }
    }

    const stock = await this.findOrCreateStock(tenantId, req.productId, req.warehouseId);
    stock.quantity = round(Number(stock.quantity) + req.quantity, 4);
    const saved = await this.stockRepo.save(stock);

    const type = options.movementType ?? StockMovementType.IN;
    const movement = await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: req.productId,
        warehouseId: req.warehouseId,
        type,
        quantity: req.quantity,
        unitCost: Number(req.unitCost),
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        createdBy: userId,
        description: req.description,
      }),
    );

    await this.lotsService.addLots(
      {
        tenantId,
        userId,
        productId: req.productId,
        warehouseId: req.warehouseId,
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        movementId: movement?.id,
      },
      product,
      allocations,
      Number(req.unitCost),
    );

    this.eventEmitter.emit(
      'stock.adjusted',
      new StockAdjustedEvent(tenantId, userId, req.productId, req.warehouseId, req.quantity, type),
    );
    return saved;
  }

  /**
   * Goods issue (Odoo outgoing picking validation). Returns the cost of the
   * goods issued at the current average cost (0 for services) and the lots
   * consumed (FEFO unless lots are given).
   */
  async issue(
    tenantId: string,
    userId: string,
    req: StockIssueRequest,
    options: StockIssueOptions = {},
  ): Promise<StockIssueResult> {
    if (!(req.quantity > 0)) throw new BadRequestException('Issued quantity must be positive');
    const product = await this.getStockableProduct(tenantId, req.productId);
    if (!product) return { unitCost: 0, cost: 0, lots: [] };

    let stock = await this.stockRepo.findOne({
      where: { tenantId, productId: req.productId, warehouseId: req.warehouseId },
    });
    const quantity = Number(stock?.quantity ?? 0);
    const reserved = Number(stock?.reservedQty ?? 0);
    const releasable = Math.min(Number(req.releaseReserved ?? 0), reserved);
    const available = quantity - (reserved - releasable);
    let allowNegative = false;
    if (!stock || available + EPS < req.quantity) {
      allowNegative = await this.settings.allowNegativeStock(tenantId);
      if (!allowNegative) {
        throw new BadRequestException(
          `Insufficient stock for ${product.code}: available ${round(available, 4)}, requested ${req.quantity}`,
        );
      }
      if (!stock) {
        await this.assertWarehouse(tenantId, req.warehouseId);
        stock = this.stockRepo.create({
          tenantId,
          productId: req.productId,
          warehouseId: req.warehouseId,
          quantity: 0,
          reservedQty: 0,
        });
      }
    }

    stock.quantity = round(quantity - req.quantity, 4);
    stock.reservedQty = round(reserved - Math.min(releasable, req.quantity), 4);
    await this.stockRepo.save(stock);

    const unitCost = Number(product.costPrice || 0);
    const type = options.movementType ?? StockMovementType.OUT;
    const movement = await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: req.productId,
        warehouseId: req.warehouseId,
        type,
        quantity: -req.quantity,
        unitCost,
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        createdBy: userId,
        description: req.description,
      }),
    );

    const lots = await this.lotsService.consume(
      {
        tenantId,
        userId,
        productId: req.productId,
        warehouseId: req.warehouseId,
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        movementId: movement?.id,
      },
      product,
      req.quantity,
      {
        lots: req.lots,
        includeExpired: options.includeExpiredLots === true,
        onHand: quantity,
        allowShortage: allowNegative,
      },
    );

    this.eventEmitter.emit(
      'stock.adjusted',
      new StockAdjustedEvent(tenantId, userId, req.productId, req.warehouseId, -req.quantity, type),
    );
    return { unitCost, cost: round(unitCost * req.quantity, 4), lots };
  }

  /**
   * Manual goods receipt with explicit lots (opening stock, goods found...).
   * Tracked products must give their lots/serials (and expiry dates when the
   * product has expiry). Posts Dr inventory / Cr stock adjustment.
   */
  async manualReceipt(
    tenantId: string,
    userId: string,
    dto: { productId: string; warehouseId: string; quantity: number; unitCost?: number; reason?: string; lots?: StockLotInput[] },
  ): Promise<Stock | null> {
    const product = await this.getStockableProduct(tenantId, dto.productId);
    if (!product) throw new BadRequestException('Services are not stockable');
    const unitCost = dto.unitCost ?? Number(product.costPrice || 0);
    if (unitCost < 0) throw new BadRequestException('Unit cost cannot be negative');
    const value = round(Number(dto.quantity) * unitCost, 4);
    if (value > 0) {
      await this.autoPosting.preflight(tenantId, today(), ['inventoryAccountId', 'stockAdjustmentAccountId']);
    }
    const stock = await this.receive(
      tenantId,
      userId,
      {
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: Number(dto.quantity),
        unitCost,
        referenceType: 'manual_receipt',
        description: dto.reason,
        lots: dto.lots,
      },
      { strictLots: true },
    );
    if (value > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: today(),
        description: `Stock receipt ${product.code}${dto.reason ? ` - ${dto.reason}` : ''}`,
        sourceType: 'stock_receipt',
        sourceId: stock?.id ?? product.id,
        buildLines: (_s, account) => [
          { accountId: account('inventoryAccountId'), debit: value },
          { accountId: account('stockAdjustmentAccountId'), credit: value },
        ],
      });
    }
    return stock;
  }

  /** Reserves up to `quantity` of available stock; returns the quantity reserved. */
  async reserve(tenantId: string, productId: string, warehouseId: string, quantity: number): Promise<number> {
    const product = await this.getStockableProduct(tenantId, productId);
    if (!product || !(quantity > 0)) return 0;
    const stock = await this.stockRepo.findOne({ where: { tenantId, productId, warehouseId } });
    if (!stock) return 0;
    const available = Number(stock.quantity) - Number(stock.reservedQty);
    const reserved = Math.max(Math.min(available, quantity), 0);
    if (reserved > 0) {
      stock.reservedQty = Number(stock.reservedQty) + reserved;
      await this.stockRepo.save(stock);
    }
    return reserved;
  }

  async release(tenantId: string, productId: string, warehouseId: string, quantity: number): Promise<void> {
    if (!(quantity > 0)) return;
    const stock = await this.stockRepo.findOne({ where: { tenantId, productId, warehouseId } });
    if (!stock) return;
    stock.reservedQty = Math.max(Number(stock.reservedQty) - quantity, 0);
    await this.stockRepo.save(stock);
  }

  /** Inventory valuation at average cost (Odoo stock valuation report). */
  async getValuation(tenantId: string, warehouseId?: string) {
    const stocks = await this.getStock(tenantId, undefined, warehouseId);
    const lines = stocks
      .filter((s) => s.product)
      .map((s) => {
        const quantity = Number(s.quantity);
        const unitCost = Number(s.product.costPrice || 0);
        return {
          productId: s.productId,
          productCode: s.product.code,
          productName: s.product.nameEn || s.product.nameAr,
          warehouseId: s.warehouseId,
          warehouseName: s.warehouse?.nameEn || s.warehouse?.nameAr,
          quantity,
          reservedQty: Number(s.reservedQty),
          availableQty: quantity - Number(s.reservedQty),
          unitCost,
          value: round(quantity * unitCost, 4),
        };
      });
    return { lines, totalValue: round(lines.reduce((sum, l) => sum + l.value, 0), 4) };
  }

  async getUnitCost(tenantId: string, productId: string): Promise<number> {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    return Number(product?.costPrice ?? 0);
  }

  async isStockable(tenantId: string, productId: string): Promise<boolean> {
    return (await this.getStockableProduct(tenantId, productId)) !== null;
  }

  /**
   * Converts a quantity expressed in `unitId` (base or alternate unit of the
   * product) to the product's base unit. Same as ProductsService.toBaseQuantity.
   */
  toBaseQuantity(tenantId: string, productId: string, quantity: number, unitId?: string | null): Promise<number> {
    return this.productsService.toBaseQuantity(tenantId, productId, quantity, unitId);
  }

  async allowNegativeStock(tenantId: string): Promise<boolean> {
    return this.settings.allowNegativeStock(tenantId);
  }

  private fallbackLotName(req: StockMoveRequest): string {
    // "Receipt PO-000012" -> "PO-000012"
    const token = req.description?.trim().split(/\s+/).pop();
    if (token && /\d/.test(token)) return token;
    return `${req.referenceType || 'IN'}-${today()}`;
  }

  private async getStockableProduct(tenantId: string, productId: string): Promise<Product | null> {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    return product.type === ProductType.SERVICE ? null : product;
  }

  private async assertWarehouse(tenantId: string, warehouseId: string): Promise<void> {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId, tenantId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
  }

  private async findOrCreateStock(tenantId: string, productId: string, warehouseId: string): Promise<Stock> {
    const existing = await this.stockRepo.findOne({ where: { tenantId, productId, warehouseId } });
    return (
      existing ??
      this.stockRepo.create({ tenantId, productId, warehouseId, quantity: 0, reservedQty: 0 })
    );
  }

  private async totalOnHand(tenantId: string, productId: string): Promise<number> {
    const stocks = await this.stockRepo.find({ where: { tenantId, productId } });
    return stocks.reduce((sum, s) => sum + Number(s.quantity), 0);
  }
}
