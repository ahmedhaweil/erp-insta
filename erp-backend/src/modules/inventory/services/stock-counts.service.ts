import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { StockCount, StockCountLine, StockCountStatus } from '../entities/stock-count.entity';
import { Product, ProductType } from '../entities/product.entity';
import { Category } from '../entities/category.entity';
import { Stock } from '../entities/stock.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { CreateStockCountDto, UpdateStockCountLinesDto, ValidateStockCountDto } from '../dto/stock-count.dto';
import { StockService } from './stock.service';
import { LotsService, isTracked } from './lots.service';
import { ProductsService } from './products.service';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { round, today } from '@shared/utils/document-totals.util';

const EPS = 0.00005;

const key = (productId: string, lotNumber: string | null | undefined) => `${productId}|${lotNumber ?? ''}`;

/**
 * Physical inventory (جرد, Odoo inventory adjustment session).
 *
 * Opening a count snapshots the system quantities of a warehouse (optionally
 * one category), per lot for tracked products. Counted quantities are entered
 * in bulk (or scanned by barcode), differences and their value are shown, and
 * validation adjusts stock to the counted quantities and posts the net
 * difference to the stock adjustment account in one entry. Stock is not
 * locked while counting; moves made after the snapshot are flagged.
 */
@Injectable()
export class StockCountsService {
  constructor(
    @InjectRepository(StockCount)
    private readonly countRepo: Repository<StockCount>,
    @InjectRepository(StockCountLine)
    private readonly lineRepo: Repository<StockCountLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Stock)
    private readonly stockRepo: Repository<Stock>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly stockService: StockService,
    private readonly lotsService: LotsService,
    private readonly productsService: ProductsService,
    private readonly sequenceService: SequenceService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateStockCountDto) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');

    const productWhere: any = { tenantId, type: ProductType.GOODS, isActive: true };
    if (dto.categoryId) {
      productWhere.categoryId = In(await this.categoryTree(tenantId, dto.categoryId));
    }
    if (dto.productIds?.length) productWhere.id = In(dto.productIds);
    const products = await this.productRepo.find({ where: productWhere, order: { code: 'ASC' } });
    const productIds = products.map((p) => p.id);

    const stocks = productIds.length
      ? await this.stockRepo.find({ where: { tenantId, warehouseId: dto.warehouseId, productId: In(productIds) } })
      : [];
    const stockByProduct = new Map(stocks.map((s) => [s.productId, Number(s.quantity)]));
    const lots = await this.lotsService.findWarehouseLots(tenantId, dto.warehouseId, productIds);

    const lines: Partial<StockCountLine>[] = [];
    for (const product of products) {
      const hasStockRecord = stockByProduct.has(product.id);
      if (!hasStockRecord && !dto.includeAllProducts && !dto.productIds?.length) continue;
      const onHand = stockByProduct.get(product.id) ?? 0;
      const base = { tenantId, productId: product.id, unitCost: Number(product.costPrice || 0), countedQty: null };
      if (isTracked(product)) {
        const productLots = lots.filter((l) => l.productId === product.id);
        for (const lot of productLots) {
          lines.push({ ...base, lotNumber: lot.lotNumber, expiryDate: lot.expiryDate, systemQty: Number(lot.quantity) });
        }
        const untracked = round(onHand - productLots.reduce((s, l) => s + Number(l.quantity), 0), 4);
        if (Math.abs(untracked) > EPS || productLots.length === 0) {
          lines.push({ ...base, lotNumber: null, expiryDate: null, systemQty: untracked });
        }
      } else {
        lines.push({ ...base, lotNumber: null, expiryDate: null, systemQty: onHand });
      }
    }

    const count = await this.countRepo.save(
      this.countRepo.create({
        tenantId,
        countNumber: await this.sequenceService.next(tenantId, 'stock_count', 'CNT'),
        date: dto.date || today(),
        warehouseId: dto.warehouseId,
        categoryId: dto.categoryId ?? null,
        notes: dto.notes ?? null,
        status: StockCountStatus.OPEN,
        createdBy: userId,
        lines: lines as StockCountLine[],
      }),
    );
    return this.findById(tenantId, count.id);
  }

  findAll(tenantId: string, filter: { status?: StockCountStatus; warehouseId?: string } = {}) {
    const where: any = { tenantId };
    if (filter.status) where.status = filter.status;
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    return this.countRepo.find({ where, relations: ['warehouse'], order: { createdAt: 'DESC' } });
  }

  /** Count with lines, differences, values and warnings. */
  async findById(tenantId: string, id: string) {
    const count = await this.load(tenantId, id);
    const current = count.status === StockCountStatus.OPEN ? await this.currentQuantities(tenantId, count) : null;

    let gainValue = 0;
    let lossValue = 0;
    let counted = 0;
    let moved = 0;
    const lines = count.lines.map((l) => {
      const systemQty = Number(l.systemQty);
      const countedQty = l.countedQty === null || l.countedQty === undefined ? null : Number(l.countedQty);
      const differenceQty =
        l.appliedQty !== null && l.appliedQty !== undefined
          ? Number(l.appliedQty)
          : countedQty === null
            ? null
            : round(countedQty - systemQty, 4);
      const unitCost = Number(l.unitCost);
      const differenceValue = differenceQty === null ? null : round(differenceQty * unitCost, 4);
      if (differenceValue && differenceValue > 0) gainValue += differenceValue;
      if (differenceValue && differenceValue < 0) lossValue -= differenceValue;
      if (countedQty !== null) counted++;
      const currentQty = current ? current.get(key(l.productId, l.lotNumber)) ?? 0 : null;
      const movedSinceSnapshot = currentQty !== null && Math.abs(currentQty - systemQty) > EPS;
      if (movedSinceSnapshot) moved++;
      return {
        id: l.id,
        productId: l.productId,
        productCode: l.product?.code,
        productName: l.product?.nameEn || l.product?.nameAr,
        lotNumber: l.lotNumber,
        expiryDate: l.expiryDate,
        systemQty,
        countedQty,
        differenceQty,
        unitCost,
        differenceValue,
        appliedQty: l.appliedQty === null || l.appliedQty === undefined ? null : Number(l.appliedQty),
        currentQty,
        movedSinceSnapshot,
      };
    });

    const warnings: string[] = [];
    if (count.status === StockCountStatus.OPEN) {
      if (moved) {
        warnings.push(
          `${moved} line(s) moved since the snapshot; validation adjusts to the counted quantity against the stock at that time`,
        );
      }
      const others = await this.countRepo.find({
        where: { tenantId, warehouseId: count.warehouseId, status: StockCountStatus.OPEN, id: Not(count.id) },
      });
      if (others.length) {
        warnings.push(`Other open counts on this warehouse: ${others.map((o) => o.countNumber).join(', ')}`);
      }
    }

    const { lines: _lines, ...header } = count;
    return {
      ...header,
      lines,
      summary: {
        totalLines: lines.length,
        countedLines: counted,
        uncountedLines: lines.length - counted,
        gainValue: round(gainValue, 4),
        lossValue: round(lossValue, 4),
        netValue: round(gainValue - lossValue, 4),
      },
      warnings,
    };
  }

  /** Bulk entry of counted quantities (by line, product + lot, or barcode). */
  async updateLines(tenantId: string, id: string, dto: UpdateStockCountLinesDto) {
    const count = await this.load(tenantId, id);
    if (count.status !== StockCountStatus.OPEN) throw new ConflictException('Only open counts can be edited');

    const toSave = new Map<string, StockCountLine>();
    const added: StockCountLine[] = [];
    for (const entry of dto.lines) {
      let productId = entry.productId;
      let quantity = Number(entry.countedQty);
      if (entry.barcode && !productId && !entry.lineId) {
        const found = await this.productsService.lookupBarcode(tenantId, entry.barcode);
        productId = found.product.id;
        if (!entry.unitId) quantity = round(quantity * found.factor, 4);
      }

      let line: StockCountLine | undefined;
      if (entry.lineId) {
        line = count.lines.find((l) => l.id === entry.lineId);
        if (!line) throw new BadRequestException(`Line ${entry.lineId} does not belong to this count`);
        productId = line.productId;
      } else {
        if (!productId) throw new BadRequestException('Each entry needs lineId, productId or barcode');
        const lotNumber = entry.lotNumber?.trim() || null;
        line = [...count.lines, ...added].find((l) => l.productId === productId && (l.lotNumber ?? null) === lotNumber);
      }
      if (entry.unitId) {
        quantity = await this.productsService.toBaseQuantity(tenantId, productId!, quantity, entry.unitId);
      }

      if (!line) {
        line = await this.newLine(tenantId, count, productId!, entry.lotNumber?.trim() || null, entry.expiryDate);
        added.push(line);
      }
      line.countedQty =
        entry.accumulate && line.countedQty !== null && line.countedQty !== undefined
          ? round(Number(line.countedQty) + quantity, 4)
          : quantity;
      if (line.id) toSave.set(line.id, line);
    }
    const rows = [...toSave.values(), ...added].map((l) => {
      const { product: _p, count: _c, ...row } = l as any;
      return row as StockCountLine;
    });
    await this.lineRepo.save(rows);
    return this.findById(tenantId, id);
  }

  /**
   * Adjusts stock to the counted quantities and posts the net value of the
   * differences (gain: Dr inventory / Cr stock adjustment; loss: reverse).
   */
  async validate(tenantId: string, userId: string, id: string, dto: ValidateStockCountDto = {}) {
    const count = await this.load(tenantId, id);
    if (count.status !== StockCountStatus.OPEN) throw new ConflictException('Only open counts can be validated');
    const date = today();
    const current = await this.currentQuantities(tenantId, count);
    const products = new Map<string, Product>();
    for (const p of await this.productRepo.find({
      where: { tenantId, id: In([...new Set(count.lines.map((l) => l.productId))]) },
    })) {
      products.set(p.id, p);
    }

    const plan: { line: StockCountLine; diff: number; value: number }[] = [];
    for (const line of count.lines) {
      let counted = line.countedQty === null || line.countedQty === undefined ? null : Number(line.countedQty);
      if (counted === null) {
        if (!dto.zeroUncounted) continue;
        counted = 0;
      }
      const diff = round(counted - (current.get(key(line.productId, line.lotNumber)) ?? 0), 4);
      const unitCost = Number(products.get(line.productId)?.costPrice ?? line.unitCost ?? 0);
      line.unitCost = unitCost;
      line.appliedQty = diff;
      if (dto.zeroUncounted && line.countedQty === null) line.countedQty = 0;
      plan.push({ line, diff, value: round(diff * unitCost, 4) });
    }

    const net = round(plan.reduce((s, p) => s + p.value, 0), 4);
    if (Math.abs(net) > 0) {
      await this.autoPosting.preflight(tenantId, date, ['inventoryAccountId', 'stockAdjustmentAccountId']);
    }

    // Losses first so lots and untracked stock are freed before gains land.
    for (const { line, diff } of [...plan].sort((a, b) => a.diff - b.diff)) {
      if (Math.abs(diff) <= EPS) continue;
      const product = products.get(line.productId);
      const tracked = product ? isTracked(product) : false;
      await this.stockService.adjust(
        tenantId,
        userId,
        {
          productId: line.productId,
          warehouseId: count.warehouseId,
          quantity: diff,
          reason: `Stock count ${count.countNumber}`,
          lots:
            tracked && line.lotNumber
              ? [{ lotNumber: line.lotNumber, quantity: Math.abs(diff), expiryDate: line.expiryDate ?? undefined }]
              : undefined,
        },
        {
          post: false,
          referenceType: 'stock_count',
          referenceId: count.id,
          untrackedOnly: tracked && !line.lotNumber,
        },
      );
    }

    if (Math.abs(net) > 0) {
      const amount = Math.abs(net);
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Stock count ${count.countNumber}`,
        sourceType: 'stock_count',
        sourceId: count.id,
        buildLines: (_s, account) =>
          net > 0
            ? [
                { accountId: account('inventoryAccountId'), debit: amount },
                { accountId: account('stockAdjustmentAccountId'), credit: amount },
              ]
            : [
                { accountId: account('stockAdjustmentAccountId'), debit: amount },
                { accountId: account('inventoryAccountId'), credit: amount },
              ],
      });
    }

    await this.lineRepo.save(
      plan.map(({ line }) => {
        const { product: _p, count: _c, ...row } = line as any;
        return row as StockCountLine;
      }),
    );
    count.status = StockCountStatus.VALIDATED;
    count.validatedAt = new Date();
    count.differenceValue = net;
    const { lines: _l, warehouse: _w, ...header } = count as any;
    await this.countRepo.save(header);
    return this.findById(tenantId, id);
  }

  async cancel(tenantId: string, id: string) {
    const count = await this.load(tenantId, id);
    if (count.status !== StockCountStatus.OPEN) throw new ConflictException('Only open counts can be cancelled');
    await this.countRepo.update({ id: count.id, tenantId }, { status: StockCountStatus.CANCELLED });
    return this.findById(tenantId, id);
  }

  /** Live quantity per (product, lot) for the products of a count. */
  private async currentQuantities(tenantId: string, count: StockCount): Promise<Map<string, number>> {
    const productIds = [...new Set(count.lines.map((l) => l.productId))];
    const result = new Map<string, number>();
    if (!productIds.length) return result;
    const stocks = await this.stockRepo.find({
      where: { tenantId, warehouseId: count.warehouseId, productId: In(productIds) },
    });
    const lots = await this.lotsService.findWarehouseLots(tenantId, count.warehouseId, productIds);
    for (const id of productIds) {
      const onHand = Number(stocks.find((s) => s.productId === id)?.quantity ?? 0);
      const productLots = lots.filter((l) => l.productId === id);
      for (const lot of productLots) result.set(key(id, lot.lotNumber), Number(lot.quantity));
      result.set(key(id, null), round(onHand - productLots.reduce((s, l) => s + Number(l.quantity), 0), 4));
    }
    return result;
  }

  private async newLine(
    tenantId: string,
    count: StockCount,
    productId: string,
    lotNumber: string | null,
    expiryDate?: string,
  ): Promise<StockCountLine> {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.type === ProductType.SERVICE) throw new BadRequestException('Services are not counted');
    if (lotNumber && !isTracked(product)) {
      throw new BadRequestException(`Product ${product.code} is not tracked by lot/serial number`);
    }
    const current = await this.currentQuantities(tenantId, {
      ...count,
      lines: [{ productId } as StockCountLine],
    } as StockCount);
    return this.lineRepo.create({
      tenantId,
      countId: count.id,
      productId,
      lotNumber,
      expiryDate: expiryDate ?? null,
      systemQty: current.get(key(productId, lotNumber)) ?? 0,
      unitCost: Number(product.costPrice || 0),
      countedQty: null,
    });
  }

  private async categoryTree(tenantId: string, rootId: string): Promise<string[]> {
    const categories = await this.categoryRepo.find({ where: { tenantId } });
    if (!categories.some((c) => c.id === rootId)) throw new NotFoundException('Category not found');
    const ids = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of categories) {
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
      }
    }
    return [...ids];
  }

  private async load(tenantId: string, id: string): Promise<StockCount> {
    const count = await this.countRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'lines.product', 'warehouse'],
    });
    if (!count) throw new NotFoundException('Stock count not found');
    count.lines.sort((a, b) =>
      (a.product?.code ?? '').localeCompare(b.product?.code ?? '') ||
      (a.lotNumber ?? '').localeCompare(b.lotNumber ?? ''),
    );
    return count;
  }
}
