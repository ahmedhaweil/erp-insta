import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Bom } from '../entities/bom.entity';
import { ProductionOrder, ProductionOrderStatus } from '../entities/production-order.entity';
import { BomLineType } from '../entities/bom-line.entity';
import { RequirementsQueryDto } from '../dto/production.dto';
import { BomsService } from './boms.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { round } from '@shared/utils/document-totals.util';

/**
 * Manufacturing reports: MRP-lite component requirements (required vs
 * available vs to buy) and production cost summary.
 */
@Injectable()
export class ManufacturingReportsService {
  constructor(
    @InjectRepository(ProductionOrder)
    private readonly orderRepo: Repository<ProductionOrder>,
    private readonly bomsService: BomsService,
    private readonly stockService: StockService,
  ) {}

  /**
   * Component requirements for a planned quantity. Sub-assemblies with their
   * own active BOM are exploded unless `explode=false`. Availability is free
   * stock (on hand minus reserved). `openOrderDemand` is what confirmed /
   * in-progress production orders still need and have not reserved yet.
   * No purchase documents are generated: the shortage list is returned.
   */
  async requirements(tenantId: string, query: RequirementsQueryDto) {
    let bom: Bom | null;
    if (query.bomId) bom = await this.bomsService.findById(tenantId, query.bomId);
    else if (query.productId) bom = await this.bomsService.getActiveBom(tenantId, query.productId);
    else throw new BadRequestException('bomId or productId is required');
    if (!bom) throw new NotFoundException('The product has no active bill of materials');

    const explosion = await this.bomsService.explode(
      tenantId,
      bom,
      Number(query.quantity),
      query.explode ?? true,
    );
    const ids = explosion.components.map((c) => c.productId);
    const products = await this.bomsService.productMap(tenantId, ids);
    const openDemand = await this.openOrderDemand(tenantId, ids, query.warehouseId);

    const lines = [];
    for (const c of explosion.components) {
      const product = products.get(c.productId);
      const stockable = await this.stockService.isStockable(tenantId, c.productId);
      const stocks = stockable
        ? await this.stockService.getStock(tenantId, c.productId, query.warehouseId)
        : [];
      const onHand = round(stocks.reduce((s, st) => s + Number(st.quantity), 0), 4);
      const available = round(
        stocks.reduce((s, st) => s + Number(st.quantity) - Number(st.reservedQty), 0),
        4,
      );
      const demand = openDemand.get(c.productId) ?? 0;
      const netAvailable = round(Math.max(available - demand, 0), 4);
      const shortage = stockable ? round(Math.max(c.quantity - netAvailable, 0), 4) : 0;
      const reorderQty = Number(product?.reorderQty || 0);
      const unitCost = Number(product?.costPrice || 0);
      const toBuy = shortage > 0 ? Math.max(shortage, reorderQty) : 0;
      lines.push({
        productId: c.productId,
        productCode: product?.code,
        productName: product?.nameEn || product?.nameAr,
        level: c.level,
        stockable,
        required: c.quantity,
        onHand,
        available,
        openOrderDemand: round(demand, 4),
        netAvailable,
        shortage,
        toBuy: round(toBuy, 4),
        unitCost,
        estimatedCost: round(toBuy * unitCost, 4),
        preferredSupplierId: product?.preferredSupplierId ?? null,
      });
    }
    const shortages = lines.filter((l) => l.shortage > 0);
    return {
      bomId: bom.id,
      productId: bom.productId,
      quantity: Number(query.quantity),
      warehouseId: query.warehouseId ?? null,
      exploded: query.explode ?? true,
      lines,
      shortages,
      canProduce: shortages.length === 0,
      estimatedPurchaseCost: round(shortages.reduce((s, l) => s + l.estimatedCost, 0), 4),
      labourCost: explosion.labourCost,
      overheadCost: explosion.overheadCost,
    };
  }

  /** Production cost summary per order for a period. */
  async productionCostSummary(tenantId: string, from?: string, to?: string) {
    const qb = this.orderRepo
      .createQueryBuilder('o')
      .leftJoinAndSelect('o.product', 'p')
      .leftJoinAndSelect('o.lines', 'ol')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.status IN (:...statuses)', {
        statuses: [ProductionOrderStatus.IN_PROGRESS, ProductionOrderStatus.DONE],
      })
      .orderBy('o.created_at', 'DESC');
    if (from) qb.andWhere('COALESCE(o.completed_date, o.created_at::date) >= :from', { from });
    if (to) qb.andWhere('COALESCE(o.completed_date, o.created_at::date) <= :to', { to });
    const orders = await qb.getMany();
    const rows = orders.map((o) => {
      const produced = Number(o.producedQuantity);
      // Finished-product cost only: the by-products' share is excluded on both sides
      const byProductCost = (o.lines ?? [])
        .filter((l) => l.type === BomLineType.BY_PRODUCT)
        .reduce((s, l) => s + Number(l.actualCost), 0);
      const actual = round(
        Number(o.actualComponentCost) +
          Number(o.actualLabourCost) +
          Number(o.actualOverheadCost) -
          byProductCost,
        4,
      );
      const standard = round(Number(o.standardUnitCost) * produced, 4);
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        productId: o.productId,
        productName: o.product?.nameEn || o.product?.nameAr,
        status: o.status,
        plannedQuantity: Number(o.plannedQuantity),
        producedQuantity: produced,
        standardUnitCost: Number(o.standardUnitCost),
        standardCost: standard,
        actualCost: actual,
        actualUnitCost: produced > 0 ? round(actual / produced, 4) : 0,
        variance: round(actual - standard, 4),
        scrapCost: Number(o.scrapCost),
      };
    });
    return {
      rows,
      totals: {
        standardCost: round(rows.reduce((s, r) => s + r.standardCost, 0), 4),
        actualCost: round(rows.reduce((s, r) => s + r.actualCost, 0), 4),
        variance: round(rows.reduce((s, r) => s + r.variance, 0), 4),
        scrapCost: round(rows.reduce((s, r) => s + r.scrapCost, 0), 4),
      },
    };
  }

  private async openOrderDemand(
    tenantId: string,
    productIds: string[],
    warehouseId?: string,
  ): Promise<Map<string, number>> {
    const demand = new Map<string, number>();
    if (!productIds.length) return demand;
    const where: any = {
      tenantId,
      status: In([ProductionOrderStatus.CONFIRMED, ProductionOrderStatus.IN_PROGRESS]),
    };
    if (warehouseId) where.sourceWarehouseId = warehouseId;
    const orders = await this.orderRepo.find({ where, relations: ['lines'] });
    for (const order of orders) {
      for (const line of order.lines ?? []) {
        if (line.type !== BomLineType.COMPONENT || !productIds.includes(line.productId)) continue;
        const open =
          Number(line.plannedQuantity) - Number(line.doneQuantity) - Number(line.reservedQuantity);
        if (open > 0) demand.set(line.productId, (demand.get(line.productId) ?? 0) + open);
      }
    }
    return demand;
  }
}
