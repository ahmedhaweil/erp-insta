import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionOrder, ProductionOrderStatus } from '../entities/production-order.entity';
import { ProductionOrderLine } from '../entities/production-order-line.entity';
import { ProductionRecord, ProductionRecordMove } from '../entities/production-record.entity';
import { Scrap } from '../entities/scrap.entity';
import { Bom } from '../entities/bom.entity';
import { BomLineType } from '../entities/bom-line.entity';
import {
  ConfirmProductionOrderDto,
  CreateProductionOrderDto,
  CreateScrapDto,
  ProduceDto,
  ProductionOrderQueryDto,
} from '../dto/production.dto';
import { BomsService } from './boms.service';
import { Warehouse } from '@modules/inventory/entities/warehouse.entity';
import { StockService } from '@modules/inventory/services/stock.service';
import {
  AutoPostingService,
  SettingsAccountKey,
} from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';

export interface ComponentAvailability {
  productId: string;
  required: number;
  available: number;
  shortage: number;
}

const OPEN_STATUSES = [ProductionOrderStatus.CONFIRMED, ProductionOrderStatus.IN_PROGRESS];

/**
 * Production orders (Odoo mrp.production / أوامر الإنتاج) with industrial
 * costing: components are issued at average cost, finished goods are
 * received at (components + absorbed labour/overhead) / produced quantity.
 *
 * Posting per production run:
 *   Dr Inventory (finished goods and by-products)  = total cost
 *     Cr Inventory (components consumed)            = components cost
 *     Cr Manufacturing overhead (absorbed)          = labour + overhead (+ service components)
 */
@Injectable()
export class ProductionOrdersService {
  constructor(
    @InjectRepository(ProductionOrder)
    private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(ProductionOrderLine)
    private readonly lineRepo: Repository<ProductionOrderLine>,
    @InjectRepository(ProductionRecord)
    private readonly recordRepo: Repository<ProductionRecord>,
    @InjectRepository(Scrap)
    private readonly scrapRepo: Repository<Scrap>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly bomsService: BomsService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, query: ProductionOrderQueryDto = {}): Promise<ProductionOrder[]> {
    const where: any = { tenantId };
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    return this.orderRepo.find({
      where,
      relations: ['product'],
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  async findById(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'lines.product', 'product'],
    });
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  getRecords(tenantId: string, orderId: string): Promise<ProductionRecord[]> {
    return this.recordRepo.find({ where: { tenantId, orderId }, order: { createdAt: 'ASC' } });
  }

  async create(tenantId: string, userId: string, dto: CreateProductionOrderDto): Promise<ProductionOrder> {
    let bom: Bom | null;
    if (dto.bomId) {
      bom = await this.bomsService.findById(tenantId, dto.bomId);
      if (dto.productId && dto.productId !== bom.productId) {
        throw new BadRequestException('The BOM does not produce this product');
      }
    } else {
      if (!dto.productId) throw new BadRequestException('Either bomId or productId is required');
      bom = await this.bomsService.getActiveBom(tenantId, dto.productId);
      if (!bom) throw new NotFoundException('The product has no active bill of materials');
    }
    const destinationWarehouseId = dto.destinationWarehouseId ?? dto.sourceWarehouseId;
    await this.assertWarehouse(tenantId, dto.sourceWarehouseId);
    if (destinationWarehouseId !== dto.sourceWarehouseId) {
      await this.assertWarehouse(tenantId, destinationWarehouseId);
    }

    const quantity = Number(dto.quantity);
    const explosion = await this.bomsService.explode(tenantId, bom, quantity, !!dto.explode);
    const scrapByProduct = new Map(
      (bom.lines ?? [])
        .filter((l) => l.type === BomLineType.COMPONENT)
        .map((l) => [l.productId, Number(l.scrapPercent || 0)]),
    );

    const lines = [
      ...explosion.components.map((c) =>
        this.lineRepo.create({
          tenantId,
          type: BomLineType.COMPONENT,
          productId: c.productId,
          plannedQuantity: c.quantity,
          scrapPercent: c.level === 1 ? scrapByProduct.get(c.productId) ?? 0 : 0,
          costSharePercent: 0,
        }),
      ),
      ...explosion.byProducts.map((b) =>
        this.lineRepo.create({
          tenantId,
          type: BomLineType.BY_PRODUCT,
          productId: b.productId,
          plannedQuantity: b.quantity,
          scrapPercent: 0,
          costSharePercent: b.costSharePercent,
        }),
      ),
    ];

    const orderNumber = await this.sequenceService.next(tenantId, 'production_order', 'MO');
    const saved = await this.orderRepo.save(
      this.orderRepo.create({
        tenantId,
        orderNumber,
        bomId: bom.id,
        productId: bom.productId,
        plannedQuantity: quantity,
        producedQuantity: 0,
        status: ProductionOrderStatus.DRAFT,
        sourceWarehouseId: dto.sourceWarehouseId,
        destinationWarehouseId,
        plannedDate: dto.plannedDate,
        exploded: !!dto.explode,
        labourCostPerUnit: round(explosion.labourCost / quantity, 4),
        overheadCostPerUnit: round(explosion.overheadCost / quantity, 4),
        notes: dto.notes,
        createdBy: userId,
        lines,
      }),
    );
    return this.findById(tenantId, saved.id);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const order = await this.findById(tenantId, id);
    if (order.status !== ProductionOrderStatus.DRAFT) {
      throw new BadRequestException('Only draft production orders can be deleted');
    }
    await this.lineRepo.delete({ tenantId, orderId: id });
    await this.orderRepo.delete({ id, tenantId });
  }

  /** Component availability in the source warehouse for the remaining quantities. */
  async checkAvailability(tenantId: string, id: string) {
    const order = await this.findById(tenantId, id);
    return this.availability(tenantId, order);
  }

  async confirm(tenantId: string, id: string, dto: ConfirmProductionOrderDto = {}) {
    const order = await this.findById(tenantId, id);
    if (order.status !== ProductionOrderStatus.DRAFT) {
      throw new BadRequestException('Only draft production orders can be confirmed');
    }
    const availability = await this.availability(tenantId, order);
    const shortages = availability.filter((a) => a.shortage > 0);
    if (shortages.length && !dto.allowShortage) {
      const codes = new Map(order.lines.map((l) => [l.productId, l.product?.code ?? l.productId]));
      throw new BadRequestException(
        `Insufficient components to confirm the production order: ${shortages
          .map((s) => `${codes.get(s.productId)} required ${s.required}, available ${s.available}`)
          .join('; ')}`,
      );
    }

    // Freeze the standard cost at current average costs
    let componentStandard = 0;
    for (const line of order.lines) {
      line.standardUnitCost = await this.stockService.getUnitCost(tenantId, line.productId);
      if (line.type === BomLineType.COMPONENT) {
        componentStandard += Number(line.plannedQuantity) * Number(line.standardUnitCost);
        if (dto.reserve && (await this.stockService.isStockable(tenantId, line.productId))) {
          line.reservedQuantity = await this.stockService.reserve(
            tenantId,
            line.productId,
            order.sourceWarehouseId,
            Number(line.plannedQuantity),
          );
        }
      }
    }
    await this.lineRepo.save(order.lines);

    const planned = Number(order.plannedQuantity);
    const total =
      componentStandard +
      planned * (Number(order.labourCostPerUnit) + Number(order.overheadCostPerUnit));
    const byProductShare = this.byProductShare(order);
    await this.orderRepo.update(
      { id: order.id, tenantId },
      {
        status: ProductionOrderStatus.CONFIRMED,
        standardUnitCost: round((total * (1 - byProductShare / 100)) / planned, 4),
      },
    );
    return { order: await this.findById(tenantId, id), availability };
  }

  async start(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status !== ProductionOrderStatus.CONFIRMED) {
      throw new BadRequestException('Only confirmed production orders can be started');
    }
    await this.orderRepo.update(
      { id, tenantId },
      { status: ProductionOrderStatus.IN_PROGRESS, startedAt: new Date() },
    );
    return this.findById(tenantId, id);
  }

  /**
   * Records a (partial) production run: consumes components (BOM quantities
   * pro rata, or the actual quantities given), receives the finished product
   * and by-products at cost and posts the manufacturing entry.
   */
  async produce(tenantId: string, userId: string, id: string, dto: ProduceDto) {
    const order = await this.findById(tenantId, id);
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new BadRequestException('Only confirmed or in-progress production orders can produce');
    }
    const quantity = Number(dto.quantity);
    if (!(quantity > 0)) throw new BadRequestException('Produced quantity must be positive');
    const date = dto.date ?? today();
    const ratio = quantity / Number(order.plannedQuantity);

    const overrides = new Map<string, number>();
    for (const c of dto.consumption ?? []) {
      if (!order.lines.some((l) => l.productId === c.productId)) {
        throw new BadRequestException(`Product ${c.productId} is not part of this production order`);
      }
      overrides.set(c.productId, Number(c.quantity));
    }

    const components = order.lines.filter((l) => l.type === BomLineType.COMPONENT);
    const byProducts = order.lines.filter((l) => l.type === BomLineType.BY_PRODUCT);
    const labourCost = round(quantity * Number(order.labourCostPerUnit), 4);
    const overheadCost = round(quantity * Number(order.overheadCostPerUnit), 4);

    // Plan the consumption first so the posting preflight runs before any stock moves
    const plan = [] as { line: ProductionOrderLine; expected: number; actual: number; stockable: boolean }[];
    for (const line of components) {
      const expected = round(Number(line.plannedQuantity) * ratio, 4);
      const actual = round(overrides.get(line.productId) ?? expected, 4);
      plan.push({
        line,
        expected,
        actual,
        stockable: await this.stockService.isStockable(tenantId, line.productId),
      });
    }
    const hasAbsorbed =
      labourCost + overheadCost > 0 || plan.some((p) => !p.stockable && p.actual > 0);
    const keys: SettingsAccountKey[] = ['inventoryAccountId'];
    if (hasAbsorbed) keys.push('manufacturingOverheadAccountId');
    await this.autoPosting.preflight(tenantId, date, keys);

    const moves: ProductionRecordMove[] = [];
    let componentCost = 0;
    let serviceCost = 0;
    for (const { line, expected, actual, stockable } of plan) {
      let unitCost = 0;
      let cost = 0;
      if (actual > 0) {
        if (stockable) {
          const releasable = Math.min(Number(line.reservedQuantity), actual);
          const issued = await this.stockService.issue(tenantId, userId, {
            productId: line.productId,
            warehouseId: order.sourceWarehouseId,
            quantity: actual,
            releaseReserved: releasable,
            referenceType: 'production_order',
            referenceId: order.id,
            description: `Consumed by ${order.orderNumber}`,
          });
          unitCost = issued.unitCost;
          cost = issued.cost;
          line.reservedQuantity = round(Number(line.reservedQuantity) - releasable, 4);
          componentCost += cost;
        } else {
          unitCost = await this.stockService.getUnitCost(tenantId, line.productId);
          cost = round(unitCost * actual, 4);
          serviceCost += cost;
        }
      }
      line.doneQuantity = round(Number(line.doneQuantity) + actual, 4);
      line.actualCost = round(Number(line.actualCost) + cost, 4);
      moves.push({ productId: line.productId, type: 'component', expectedQuantity: expected, quantity: actual, unitCost, cost });
    }
    componentCost = round(componentCost, 4);
    serviceCost = round(serviceCost, 4);
    const totalCost = round(componentCost + serviceCost + labourCost + overheadCost, 4);

    const record = await this.recordRepo.save(
      this.recordRepo.create({
        tenantId,
        orderId: order.id,
        date,
        quantity,
        componentCost: round(componentCost + serviceCost, 4),
        labourCost,
        overheadCost,
        createdBy: userId,
        moves: [],
      }),
    );

    // By-products take their cost share; the finished product takes the rest
    let byProductCost = 0;
    for (const line of byProducts) {
      const expected = round(Number(line.plannedQuantity) * ratio, 4);
      const actual = round(overrides.get(line.productId) ?? expected, 4);
      let cost = 0;
      let unitCost = 0;
      if (actual > 0) {
        cost = round((totalCost * Number(line.costSharePercent || 0)) / 100, 4);
        unitCost = round(cost / actual, 4);
        await this.stockService.receive(tenantId, userId, {
          productId: line.productId,
          warehouseId: order.destinationWarehouseId,
          quantity: actual,
          unitCost,
          referenceType: 'production_order',
          referenceId: order.id,
          description: `By-product of ${order.orderNumber}`,
        });
        byProductCost += cost;
      }
      line.doneQuantity = round(Number(line.doneQuantity) + actual, 4);
      line.actualCost = round(Number(line.actualCost) + cost, 4);
      moves.push({ productId: line.productId, type: 'by_product', expectedQuantity: expected, quantity: actual, unitCost, cost });
    }
    byProductCost = round(byProductCost, 4);
    const finishedCost = round(totalCost - byProductCost, 4);
    const unitCost = round(finishedCost / quantity, 4);

    await this.stockService.receive(tenantId, userId, {
      productId: order.productId,
      warehouseId: order.destinationWarehouseId,
      quantity,
      unitCost,
      referenceType: 'production_order',
      referenceId: order.id,
      description: `Produced by ${order.orderNumber}`,
    });

    const absorbed = round(labourCost + overheadCost + serviceCost, 4);
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.GENERAL,
      date,
      description: `Production ${order.orderNumber} (${quantity} units)`,
      sourceType: 'production_order',
      sourceId: record.id,
      buildLines: (_s, account) => [
        { accountId: account('inventoryAccountId'), debit: totalCost, description: `Finished goods ${order.orderNumber}` },
        { accountId: account('inventoryAccountId'), credit: componentCost, description: `Components consumed ${order.orderNumber}` },
        ...(absorbed > 0
          ? [{ accountId: account('manufacturingOverheadAccountId'), credit: absorbed, description: `Labour/overhead absorbed ${order.orderNumber}` }]
          : []),
      ],
    });

    record.moves = moves;
    record.byProductCost = byProductCost;
    record.unitCost = unitCost;
    await this.recordRepo.save(record);
    await this.lineRepo.save(order.lines);

    const produced = round(Number(order.producedQuantity) + quantity, 4);
    const done = dto.finish || produced >= Number(order.plannedQuantity);
    await this.orderRepo.update(
      { id: order.id, tenantId },
      {
        producedQuantity: produced,
        actualComponentCost: round(Number(order.actualComponentCost) + componentCost + serviceCost, 4),
        actualLabourCost: round(Number(order.actualLabourCost) + labourCost, 4),
        actualOverheadCost: round(Number(order.actualOverheadCost) + overheadCost, 4),
        status: ProductionOrderStatus.IN_PROGRESS,
        startedAt: order.startedAt ?? new Date(),
      },
    );
    if (done) await this.close(tenantId, order.id, date);
    return { order: await this.findById(tenantId, id), record };
  }

  /** Marks a partially produced order as done and releases leftover reservations. */
  async finish(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.findById(tenantId, id);
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new BadRequestException('Only confirmed or in-progress production orders can be finished');
    }
    if (!(Number(order.producedQuantity) > 0)) {
      throw new BadRequestException('Nothing has been produced; cancel the order instead');
    }
    await this.close(tenantId, id, today());
    return this.findById(tenantId, id);
  }

  async cancel(tenantId: string, id: string): Promise<ProductionOrder> {
    const order = await this.findById(tenantId, id);
    if (order.status === ProductionOrderStatus.DONE || order.status === ProductionOrderStatus.CANCELLED) {
      throw new BadRequestException(`Production order is already ${order.status}`);
    }
    if (Number(order.producedQuantity) > 0) {
      throw new BadRequestException('Production has been recorded; finish the order instead');
    }
    await this.releaseReservations(tenantId, order);
    await this.orderRepo.update({ id, tenantId }, { status: ProductionOrderStatus.CANCELLED });
    return this.findById(tenantId, id);
  }

  /**
   * Scraps goods (components, work in progress or finished goods) at average
   * cost: Dr Stock adjustment (loss) / Cr Inventory.
   */
  async scrap(tenantId: string, userId: string, dto: CreateScrapDto): Promise<Scrap> {
    let order: ProductionOrder | null = null;
    if (dto.productionOrderId) {
      order = await this.findById(tenantId, dto.productionOrderId);
      if (order.status === ProductionOrderStatus.DRAFT || order.status === ProductionOrderStatus.CANCELLED) {
        throw new BadRequestException('Scrap can only be recorded on confirmed, in-progress or done orders');
      }
    }
    const warehouseId = dto.warehouseId ?? order?.sourceWarehouseId;
    if (!warehouseId) throw new BadRequestException('warehouseId is required');
    if (!(await this.stockService.isStockable(tenantId, dto.productId))) {
      throw new BadRequestException('Only stockable products can be scrapped');
    }
    const date = dto.date ?? today();
    await this.autoPosting.preflight(tenantId, date, ['inventoryAccountId', 'stockAdjustmentAccountId']);

    // Scrapping a reserved component of the order consumes its reservation
    const line =
      order && warehouseId === order.sourceWarehouseId
        ? order.lines.find((l) => l.type === BomLineType.COMPONENT && l.productId === dto.productId)
        : undefined;
    const releasable = line ? Math.min(Number(line.reservedQuantity), dto.quantity) : 0;

    const scrapNumber = await this.sequenceService.next(tenantId, 'mfg_scrap', 'SCRAP');
    const scrap = await this.scrapRepo.save(
      this.scrapRepo.create({
        tenantId,
        scrapNumber,
        productionOrderId: order?.id,
        productId: dto.productId,
        warehouseId,
        quantity: dto.quantity,
        date,
        reason: dto.reason,
        createdBy: userId,
      }),
    );
    const issued = await this.stockService.issue(tenantId, userId, {
      productId: dto.productId,
      warehouseId,
      quantity: dto.quantity,
      releaseReserved: releasable,
      referenceType: 'scrap',
      referenceId: scrap.id,
      description: `Scrap ${scrapNumber}${dto.reason ? ` - ${dto.reason}` : ''}`,
    });
    scrap.unitCost = issued.unitCost;
    scrap.cost = issued.cost;
    await this.scrapRepo.save(scrap);

    if (line && releasable > 0) {
      line.reservedQuantity = round(Number(line.reservedQuantity) - releasable, 4);
      await this.lineRepo.save(line);
    }
    if (order) {
      await this.orderRepo.update(
        { id: order.id, tenantId },
        { scrapCost: round(Number(order.scrapCost) + issued.cost, 4) },
      );
    }
    if (issued.cost > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Scrap ${scrapNumber}${order ? ` (${order.orderNumber})` : ''}`,
        sourceType: 'mfg_scrap',
        sourceId: scrap.id,
        buildLines: (_s, account) => [
          { accountId: account('stockAdjustmentAccountId'), debit: issued.cost },
          { accountId: account('inventoryAccountId'), credit: issued.cost },
        ],
      });
    }
    return scrap;
  }

  findScraps(tenantId: string, productionOrderId?: string): Promise<Scrap[]> {
    const where: any = { tenantId };
    if (productionOrderId) where.productionOrderId = productionOrderId;
    return this.scrapRepo.find({ where, order: { createdAt: 'DESC' }, take: 500 });
  }

  /**
   * Standard vs actual cost of a production order. Standard quantities are
   * the BOM quantities for the quantity actually produced (or planned, before
   * any production); the variance is split into usage (quantity) and price.
   */
  async costReport(tenantId: string, id: string) {
    const order = await this.findById(tenantId, id);
    const planned = Number(order.plannedQuantity);
    const produced = Number(order.producedQuantity);
    const basis = produced > 0 ? produced : planned;
    const ratio = basis / planned;

    const components = order.lines
      .filter((l) => l.type === BomLineType.COMPONENT)
      .map((l) => {
        const standardQuantity = round(Number(l.plannedQuantity) * ratio, 4);
        const standardUnitCost = Number(l.standardUnitCost);
        const standardCost = round(standardQuantity * standardUnitCost, 4);
        const actualQuantity = Number(l.doneQuantity);
        const actualCost = Number(l.actualCost);
        return {
          productId: l.productId,
          productCode: l.product?.code,
          productName: l.product?.nameEn || l.product?.nameAr,
          standardQuantity,
          standardUnitCost,
          standardCost,
          actualQuantity,
          actualUnitCost: actualQuantity > 0 ? round(actualCost / actualQuantity, 4) : 0,
          actualCost,
          quantityVariance: round(actualQuantity - standardQuantity, 4),
          usageVariance: round((actualQuantity - standardQuantity) * standardUnitCost, 4),
          priceVariance: round(actualCost - actualQuantity * standardUnitCost, 4),
          totalVariance: round(actualCost - standardCost, 4),
        };
      });

    const standardMaterial = round(components.reduce((s, c) => s + c.standardCost, 0), 4);
    const standardLabour = round(basis * Number(order.labourCostPerUnit), 4);
    const standardOverhead = round(basis * Number(order.overheadCostPerUnit), 4);
    const standardTotal = round(standardMaterial + standardLabour + standardOverhead, 4);
    const actualMaterial = Number(order.actualComponentCost);
    const actualLabour = Number(order.actualLabourCost);
    const actualOverhead = Number(order.actualOverheadCost);
    const actualTotal = round(actualMaterial + actualLabour + actualOverhead, 4);
    const share = this.byProductShare(order) / 100;
    const records = await this.getRecords(tenantId, id);
    const byProductCost = round(records.reduce((s, r) => s + Number(r.byProductCost), 0), 4);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      productId: order.productId,
      status: order.status,
      plannedQuantity: planned,
      producedQuantity: produced,
      costBasisQuantity: basis,
      standard: {
        material: standardMaterial,
        labour: standardLabour,
        overhead: standardOverhead,
        total: standardTotal,
        byProductCost: round(standardTotal * share, 4),
        unitCost: round((standardTotal * (1 - share)) / basis, 4),
      },
      actual: {
        material: actualMaterial,
        labour: actualLabour,
        overhead: actualOverhead,
        total: actualTotal,
        byProductCost,
        unitCost: produced > 0 ? round((actualTotal - byProductCost) / produced, 4) : 0,
      },
      variance: {
        material: round(actualMaterial - (produced > 0 ? standardMaterial : 0), 4),
        total: round(actualTotal - (produced > 0 ? standardTotal : 0), 4),
      },
      scrapCost: Number(order.scrapCost),
      components,
      byProducts: order.lines
        .filter((l) => l.type === BomLineType.BY_PRODUCT)
        .map((l) => ({
          productId: l.productId,
          plannedQuantity: Number(l.plannedQuantity),
          producedQuantity: Number(l.doneQuantity),
          cost: Number(l.actualCost),
        })),
      runs: records,
    };
  }

  private async close(tenantId: string, id: string, date: string): Promise<void> {
    const order = await this.findById(tenantId, id);
    await this.releaseReservations(tenantId, order);
    await this.orderRepo.update(
      { id, tenantId },
      { status: ProductionOrderStatus.DONE, completedDate: date },
    );
  }

  private async releaseReservations(tenantId: string, order: ProductionOrder): Promise<void> {
    const reserved = order.lines.filter((l) => Number(l.reservedQuantity) > 0);
    for (const line of reserved) {
      await this.stockService.release(
        tenantId,
        line.productId,
        order.sourceWarehouseId,
        Number(line.reservedQuantity),
      );
      line.reservedQuantity = 0;
    }
    if (reserved.length) await this.lineRepo.save(reserved);
  }

  private async availability(tenantId: string, order: ProductionOrder): Promise<ComponentAvailability[]> {
    const result: ComponentAvailability[] = [];
    for (const line of order.lines.filter((l) => l.type === BomLineType.COMPONENT)) {
      if (!(await this.stockService.isStockable(tenantId, line.productId))) continue;
      const required = round(Math.max(Number(line.plannedQuantity) - Number(line.doneQuantity), 0), 4);
      const stocks = await this.stockService.getStock(tenantId, line.productId, order.sourceWarehouseId);
      const free = stocks.reduce((s, st) => s + Number(st.quantity) - Number(st.reservedQty), 0);
      // Stock already reserved for this order counts as available to it
      const available = round(free + Number(line.reservedQuantity), 4);
      result.push({
        productId: line.productId,
        required,
        available,
        shortage: round(Math.max(required - available, 0), 4),
      });
    }
    return result;
  }

  private byProductShare(order: ProductionOrder): number {
    return order.lines
      .filter((l) => l.type === BomLineType.BY_PRODUCT)
      .reduce((s, l) => s + Number(l.costSharePercent || 0), 0);
  }

  private async assertWarehouse(tenantId: string, id: string): Promise<void> {
    const warehouse = await this.warehouseRepo.findOne({ where: { id, tenantId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
  }
}
