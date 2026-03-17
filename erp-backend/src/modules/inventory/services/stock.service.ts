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
import { Product } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { StockAdjustmentDto } from '../dto/stock-adjustment.dto';
import { StockTransferDto } from '../dto/stock-transfer.dto';
import { StockAdjustedEvent } from '../events/stock-adjusted.event';

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
    stock.quantity = newQty;

    const saved = await this.stockRepo.save(stock);

    // Record movement
    const movementType = dto.quantity >= 0 ? StockMovementType.IN : StockMovementType.OUT;
    await this.movementRepo.save(
      this.movementRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.warehouseId,
        type: StockMovementType.ADJUSTMENT,
        quantity: dto.quantity,
        referenceType: 'adjustment',
        createdBy: userId,
        description: dto.reason,
      }),
    );

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
    await this.movementRepo.save([
      this.movementRepo.create({
        tenantId,
        productId: dto.productId,
        warehouseId: dto.fromWarehouseId,
        type: StockMovementType.TRANSFER,
        quantity: -dto.quantity,
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
        referenceType: 'transfer',
        createdBy: userId,
        description: `Transfer from ${fromWarehouse.nameEn || fromWarehouse.nameAr}`,
      }),
    ]);

    return { from: fromStock, to: toStock };
  }
}
