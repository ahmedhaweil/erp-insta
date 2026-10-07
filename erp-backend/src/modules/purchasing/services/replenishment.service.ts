import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { PurchaseOrder, PurchaseOrderStatus } from '../entities/purchase-order.entity';
import { PurchaseOrdersService } from './purchase-orders.service';
import { GenerateReplenishmentDto } from '../dto/purchase-actions.dto';
import { round, today } from '@shared/utils/document-totals.util';

export interface ReplenishmentSuggestion {
  productId: string;
  productCode: string;
  productName: string;
  preferredSupplierId: string | null;
  onHand: number;
  incoming: number;
  forecast: number;
  reorderLevel: number;
  suggestedQty: number;
}

/**
 * Min/max reordering rules (Odoo replenishment): products whose forecast
 * quantity (on hand + incoming from confirmed POs) falls to the reorder
 * level are proposed for purchase, and draft RFQs can be generated per
 * preferred vendor.
 */
@Injectable()
export class ReplenishmentService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Stock)
    private readonly stockRepo: Repository<Stock>,
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,
    private readonly ordersService: PurchaseOrdersService,
  ) {}

  async getSuggestions(
    tenantId: string,
    productIds?: string[],
  ): Promise<ReplenishmentSuggestion[]> {
    const where: any = {
      tenantId,
      isActive: true,
      type: ProductType.GOODS,
      reorderLevel: MoreThan(0),
    };
    if (productIds?.length) where.id = In(productIds);
    const products = await this.productRepo.find({ where });
    if (products.length === 0) return [];

    const ids = products.map((p) => p.id);
    const stocks = await this.stockRepo.find({ where: { tenantId, productId: In(ids) } });
    const onHand = new Map<string, number>();
    for (const s of stocks) {
      onHand.set(
        s.productId,
        (onHand.get(s.productId) ?? 0) + Number(s.quantity) - Number(s.reservedQty),
      );
    }

    const openOrders = await this.orderRepo.find({
      where: {
        tenantId,
        status: In([
          PurchaseOrderStatus.DRAFT,
          PurchaseOrderStatus.SENT,
          PurchaseOrderStatus.CONFIRMED,
        ]),
      },
      relations: ['lines'],
    });
    const incoming = new Map<string, number>();
    for (const order of openOrders) {
      for (const line of order.lines) {
        const open = Number(line.quantity) - Number(line.qtyReceived ?? 0);
        if (open > 0) incoming.set(line.productId, (incoming.get(line.productId) ?? 0) + open);
      }
    }

    return products
      .map((p) => {
        const qtyOnHand = round(onHand.get(p.id) ?? 0, 4);
        const qtyIncoming = round(incoming.get(p.id) ?? 0, 4);
        const forecast = round(qtyOnHand + qtyIncoming, 4);
        const reorderLevel = Number(p.reorderLevel);
        const shortfall = reorderLevel - forecast;
        const suggestedQty =
          forecast <= reorderLevel ? Math.max(Number(p.reorderQty), shortfall, 0) : 0;
        return {
          productId: p.id,
          productCode: p.code,
          productName: p.nameEn || p.nameAr,
          preferredSupplierId: p.preferredSupplierId ?? null,
          onHand: qtyOnHand,
          incoming: qtyIncoming,
          forecast,
          reorderLevel,
          suggestedQty: round(suggestedQty, 4),
        };
      })
      .filter((s) => s.suggestedQty > 0);
  }

  /** Creates one draft RFQ per preferred vendor for all suggested products. */
  async generate(tenantId: string, userId: string, dto: GenerateReplenishmentDto) {
    const suggestions = await this.getSuggestions(tenantId, dto.productIds);
    const withSupplier = suggestions.filter((s) => s.preferredSupplierId);
    const skipped = suggestions.filter((s) => !s.preferredSupplierId);
    if (withSupplier.length === 0) {
      throw new BadRequestException(
        suggestions.length
          ? 'Products need a preferred supplier before RFQs can be generated'
          : 'No product needs replenishment',
      );
    }

    const products = await this.productRepo.find({
      where: { tenantId, id: In(withSupplier.map((s) => s.productId)) },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const bySupplier = new Map<string, ReplenishmentSuggestion[]>();
    for (const s of withSupplier) {
      const list = bySupplier.get(s.preferredSupplierId!) ?? [];
      list.push(s);
      bySupplier.set(s.preferredSupplierId!, list);
    }

    const orders: PurchaseOrder[] = [];
    for (const [supplierId, items] of bySupplier) {
      orders.push(
        await this.ordersService.create(tenantId, userId, {
          supplierId,
          date: today(),
          warehouseId: dto.warehouseId,
          notes: 'Generated by replenishment',
          lines: items.map((s) => {
            const product = productById.get(s.productId)!;
            return {
              productId: s.productId,
              quantity: s.suggestedQty,
              unitPrice: Number(product.costPrice || 0),
              taxRate: Number(product.purchaseTaxRate || 0),
            };
          }),
        }),
      );
    }

    return { orders, skipped };
  }
}
