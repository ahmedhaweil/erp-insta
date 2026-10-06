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

export interface StockMoveRequest {
  productId: string;
  warehouseId: string;
  quantity: number;
  referenceType: string;
  referenceId?: string;
  description?: string;
}

export interface StockReceiptRequest extends StockMoveRequest {
  /** Purchase unit cost, used for average-cost (AVCO) valuation. */
  unitCost: number;
}

export interface StockIssueRequest extends StockMoveRequest {
  /** Quantity previously reserved for this document that the issue consumes. */
  releaseReserved?: number;
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

  async adjust(
    tenantId: string,
    userId: string,
    dto: StockAdjustmentDto,
  ): Promise<Stock> {
    // Validate product exists
    const product = await this.productRepo.findOne({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');
    if (product.type === ProductType.SERVICE) {
      throw new BadRequestException('Services are not stockable');
    }

    // Validate warehouse exists
    const warehouse = await this.warehouseRepo.findOne({
      where: { id: dto.warehouseId, tenantId },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    // Find or create stock record
    let stock = await this.stockRepo.findOne({
      where: { tenantId, productId: dto.productId, warehouseId: dto.warehouseId },
    });

    if (!stock) {
      stock = this.stockRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        quantity: 0,
        reservedQty: 0,
      });
    }

    const newQty = Number(stock.quantity) + dto.quantity;
    if (newQty < 0) {
      throw new BadRequestException('Adjustment would result in negative stock');
    }
    if (newQty < Number(stock.reservedQty)) {
      throw new BadRequestException('Adjustment would leave less stock than is reserved');
    }
    stock.quantity = newQty;

    const unitCost = Number(product.costPrice || 0);
    if (unitCost > 0) {
      await this.autoPosting.preflight(tenantId, today(), ['inventoryAccountId', 'stockAdjustmentAccountId']);
    }

    const saved = await this.stockRepo.save(stock);

    const movement = await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        type: StockMovementType.ADJUSTMENT,
        quantity: dto.quantity,
        unitCost,
        referenceType: 'adjustment',
        createdBy: userId,
        description: dto.reason,
      }),
    );

    // Inventory gain/loss valuation entry (Odoo inventory adjustment posting)
    const value = round(Math.abs(dto.quantity) * unitCost, 4);
    if (value > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: today(),
        description: `Inventory adjustment ${product.code}${dto.reason ? ` - ${dto.reason}` : ''}`,
        sourceType: 'stock_adjustment',
        sourceId: movement?.id ?? saved.id,
        buildLines: (_s, account) =>
          dto.quantity > 0
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

    // Emit event
    this.eventEmitter.emit(
      'stock.adjusted',
      new StockAdjustedEvent(
        tenantId,
        userId,
        dto.productId,
        dto.warehouseId,
        dto.quantity,
        StockMovementType.ADJUSTMENT,
      ),
    );

    return saved;
  }

  async transfer(
    tenantId: string,
    userId: string,
    dto: StockTransferDto,
  ): Promise<{ from: Stock; to: Stock }> {
    if (dto.quantity <= 0) {
      throw new BadRequestException('Transfer quantity must be positive');
    }

    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    // Validate product exists
    const product = await this.productRepo.findOne({
      where: { id: dto.productId, tenantId },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Validate warehouses exist
    const fromWarehouse = await this.warehouseRepo.findOne({
      where: { id: dto.fromWarehouseId, tenantId },
    });
    if (!fromWarehouse) throw new NotFoundException('Source warehouse not found');

    const toWarehouse = await this.warehouseRepo.findOne({
      where: { id: dto.toWarehouseId, tenantId },
    });
    if (!toWarehouse) throw new NotFoundException('Destination warehouse not found');

    // Get source stock
    const fromStock = await this.stockRepo.findOne({
      where: { tenantId, productId: dto.productId, warehouseId: dto.fromWarehouseId },
    });
    if (!fromStock) throw new NotFoundException('No stock found in source warehouse');

    const availableQty = Number(fromStock.quantity) - Number(fromStock.reservedQty);
    if (availableQty < dto.quantity) {
      throw new BadRequestException('Insufficient available stock in source warehouse');
    }

    // Deduct from source
    fromStock.quantity = Number(fromStock.quantity) - dto.quantity;
    await this.stockRepo.save(fromStock);

    // Add to destination
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

    toStock.quantity = Number(toStock.quantity) + dto.quantity;
    await this.stockRepo.save(toStock);

    // Record movements
    const unitCost = Number(product.costPrice || 0);
    await this.movementRepo.save([
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
    ]);

    return { from: fromStock, to: toStock };
  }

  /**
   * Goods receipt (Odoo incoming picking validation). Increases on-hand stock
   * and recomputes the product's average cost.
   */
  async receive(tenantId: string, userId: string, req: StockReceiptRequest): Promise<Stock | null> {
    if (!(req.quantity > 0)) throw new BadRequestException('Received quantity must be positive');
    const product = await this.getStockableProduct(tenantId, req.productId);
    if (!product) return null;
    await this.assertWarehouse(tenantId, req.warehouseId);

    // AVCO: new cost = (on-hand value + received value) / (on-hand qty + received qty)
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

    const stock = await this.findOrCreateStock(tenantId, req.productId, req.warehouseId);
    stock.quantity = Number(stock.quantity) + req.quantity;
    const saved = await this.stockRepo.save(stock);

    await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: req.productId,
        warehouseId: req.warehouseId,
        type: StockMovementType.IN,
        quantity: req.quantity,
        unitCost: Number(req.unitCost),
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        createdBy: userId,
        description: req.description,
      }),
    );

    this.eventEmitter.emit(
      'stock.adjusted',
      new StockAdjustedEvent(tenantId, userId, req.productId, req.warehouseId, req.quantity, StockMovementType.IN),
    );
    return saved;
  }

  /**
   * Goods issue (Odoo outgoing picking validation). Returns the cost of the
   * goods issued at the current average cost (0 for services).
   */
  async issue(tenantId: string, userId: string, req: StockIssueRequest): Promise<{ unitCost: number; cost: number }> {
    if (!(req.quantity > 0)) throw new BadRequestException('Issued quantity must be positive');
    const product = await this.getStockableProduct(tenantId, req.productId);
    if (!product) return { unitCost: 0, cost: 0 };

    const stock = await this.stockRepo.findOne({
      where: { tenantId, productId: req.productId, warehouseId: req.warehouseId },
    });
    const quantity = Number(stock?.quantity ?? 0);
    const reserved = Number(stock?.reservedQty ?? 0);
    const releasable = Math.min(Number(req.releaseReserved ?? 0), reserved);
    const available = quantity - (reserved - releasable);
    if (!stock || available < req.quantity) {
      throw new BadRequestException(
        `Insufficient stock for ${product.code}: available ${round(available, 4)}, requested ${req.quantity}`,
      );
    }

    stock.quantity = quantity - req.quantity;
    stock.reservedQty = reserved - Math.min(releasable, req.quantity);
    await this.stockRepo.save(stock);

    const unitCost = Number(product.costPrice || 0);
    await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: req.productId,
        warehouseId: req.warehouseId,
        type: StockMovementType.OUT,
        quantity: -req.quantity,
        unitCost,
        referenceType: req.referenceType,
        referenceId: req.referenceId,
        createdBy: userId,
        description: req.description,
      }),
    );

    this.eventEmitter.emit(
      'stock.adjusted',
      new StockAdjustedEvent(tenantId, userId, req.productId, req.warehouseId, -req.quantity, StockMovementType.OUT),
    );
    return { unitCost, cost: round(unitCost * req.quantity, 4) };
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
