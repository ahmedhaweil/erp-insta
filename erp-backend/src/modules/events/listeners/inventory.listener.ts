import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StockAdjustedEvent } from '@modules/inventory/events/stock-adjusted.event';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { Product } from '@modules/inventory/entities/product.entity';

@Injectable()
export class InventoryListener {
  private readonly logger = new Logger(InventoryListener.name);

  constructor(
    @InjectRepository(Stock)
    private readonly stockRepo: Repository<Stock>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('stock.adjusted')
  async handleStockAdjusted(event: StockAdjustedEvent) {
    this.logger.log(
      `Stock adjusted: Product ${event.productId}, Warehouse ${event.warehouseId}, Qty: ${event.quantity} [Tenant: ${event.tenantId}]`,
    );

    // Check reorder level
    const product = await this.productRepo.findOne({
      where: { id: event.productId, tenantId: event.tenantId },
    });
    if (!product || Number(product.reorderLevel) <= 0) return;

    // Get total stock across all warehouses
    const stocks = await this.stockRepo.find({
      where: { productId: event.productId, tenantId: event.tenantId },
    });
    const totalQty = stocks.reduce((sum, s) => sum + Number(s.quantity), 0);

    if (totalQty <= Number(product.reorderLevel)) {
      this.logger.warn(
        `Low stock alert: ${product.nameEn || product.nameAr} (${totalQty} remaining, reorder level: ${product.reorderLevel})`,
      );

      this.eventEmitter.emit('stock.reorder-alert', {
        tenantId: event.tenantId,
        userId: event.userId,
        productId: event.productId,
        productName: product.nameEn || product.nameAr,
        currentQty: totalQty,
        reorderLevel: Number(product.reorderLevel),
        reorderQty: Number(product.reorderQty),
      });
    }
  }
}
