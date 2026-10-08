import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductType, TrackingType } from '@modules/inventory/entities/product.entity';
import { Warehouse } from '@modules/inventory/entities/warehouse.entity';
import { Unit } from '@modules/inventory/entities/unit.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { StockService } from '@modules/inventory/services/stock.service';
import { ProductsService } from '@modules/inventory/services/products.service';
import { Account } from '@modules/accounting/entities/account.entity';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { AccountingSettingsService } from '@modules/accounting/services/accounting-settings.service';
import { round } from '@shared/utils/document-totals.util';
import { ImportEntity } from '../entities/import-job.entity';
import type { ColumnSpec, ParsedRow } from '../utils/spreadsheet.util';
import {
  ImportContext,
  Importer,
  IssueList,
  PlannedRow,
  ValidationOutcome,
  has,
  keyOf,
  v,
} from './importer.types';
import { OffsetAccount, openingDate, resolveOffsetAccount } from './opening.helpers';

export const OPENING_STOCK_COLUMNS: ColumnSpec[] = [
  { key: 'productCode', label: { en: 'Product code', ar: 'كود الصنف' }, required: true },
  { key: 'warehouseCode', label: { en: 'Warehouse code', ar: 'كود المخزن' }, required: true },
  { key: 'quantity', label: { en: 'Quantity', ar: 'الكمية' }, type: 'number', required: true, min: 0.0001 },
  {
    key: 'unitCost',
    label: { en: 'Unit cost', ar: 'تكلفة الوحدة' },
    type: 'number',
    min: 0,
    note: { en: 'Per unit of the row; default current product cost', ar: 'لكل وحدة من وحدة الصف؛ الافتراضي تكلفة الصنف الحالية' },
  },
  {
    key: 'unit',
    label: { en: 'Unit', ar: 'الوحدة' },
    note: { en: 'Default base unit; alternate units are converted', ar: 'الافتراضي الوحدة الأساسية؛ تُحوّل الوحدات البديلة' },
  },
  {
    key: 'lotNumber',
    label: { en: 'Lot / serial number', ar: 'رقم التشغيلة / السيريال' },
    note: { en: 'Tracked products; empty = automatic lot', ar: 'للأصناف المتتبعة؛ فارغ = تشغيلة تلقائية' },
  },
  { key: 'expiryDate', label: { en: 'Expiry date', ar: 'تاريخ الصلاحية' }, type: 'date' },
];

interface StockPlan {
  productId: string;
  productCode: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  value: number;
  lots?: { lotNumber: string; quantity: number; expiryDate?: string | null }[];
}

interface StockOutcomeExtra {
  offset: OffsetAccount;
  totalValue: number;
}

/**
 * Opening stock per warehouse at a unit cost: received through
 * StockService.receive (AVCO, lots) and posted as one entry
 * Dr inventory / Cr offset (opening equity or stock adjustment).
 */
@Injectable()
export class OpeningStockImporter implements Importer<StockPlan> {
  readonly entity = ImportEntity.OPENING_STOCK;
  readonly title = { en: 'Opening stock', ar: 'أرصدة المخزون الافتتاحية' };
  readonly columns = OPENING_STOCK_COLUMNS;

  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Warehouse) private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    @InjectRepository(Stock) private readonly stockRepo: Repository<Stock>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    private readonly stockService: StockService,
    private readonly productsService: ProductsService,
    private readonly autoPosting: AutoPostingService,
    private readonly accountingSettings: AccountingSettingsService,
  ) {}

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<StockPlan>> {
    const { tenantId } = ctx;
    const issues = new IssueList();
    const date = openingDate(ctx);
    const settings = await this.accountingSettings.find(tenantId);
    const offset = await resolveOffsetAccount(ctx, this.accountRepo, settings, 'stockAdjustmentAccountId', issues);
    if (settings) {
      try {
        await this.autoPosting.preflight(tenantId, date, ['inventoryAccountId']);
      } catch (err) {
        issues.error(0, 'posting_blocked', (err as Error).message);
      }
    }

    const [products, warehouses, units, stocks] = await Promise.all([
      this.productRepo.find({ where: { tenantId } }),
      this.warehouseRepo.find({ where: { tenantId } }),
      this.unitRepo.find({ where: { tenantId } }),
      this.stockRepo.find({ where: { tenantId } }),
    ]);
    const productByCode = new Map(products.map((p) => [keyOf(p.code), p]));
    const warehouseByCode = new Map(warehouses.map((w) => [keyOf(w.code), w]));
    const unitByName = new Map<string, string>();
    for (const u of units) for (const n of [u.symbol, u.nameAr, u.nameEn]) if (n && !unitByName.has(keyOf(n))) unitByName.set(keyOf(n), u.id);
    const onHand = new Map(stocks.map((s) => [`${s.productId}:${s.warehouseId}`, Number(s.quantity)]));
    const serials = new Set<string>();
    const warned = new Set<string>();

    const planned: PlannedRow<StockPlan>[] = [];
    let totalValue = 0;
    for (const row of rows) {
      const n = row.rowNumber;
      if (!has(row, 'productCode') || !has(row, 'warehouseCode') || !has(row, 'quantity')) continue;
      const product = productByCode.get(keyOf(v(row, 'productCode')));
      const warehouse = warehouseByCode.get(keyOf(v(row, 'warehouseCode')));
      if (!product) {
        issues.error(n, 'not_found', `Product ${v(row, 'productCode')} not found`, 'productCode');
        continue;
      }
      if (product.type !== ProductType.GOODS) {
        issues.error(n, 'not_stockable', `Product ${product.code} is a service`, 'productCode');
        continue;
      }
      if (!warehouse) {
        issues.error(n, 'not_found', `Warehouse ${v(row, 'warehouseCode')} not found`, 'warehouseCode');
        continue;
      }
      let factor = 1;
      if (has(row, 'unit')) {
        const unitId = unitByName.get(keyOf(v(row, 'unit')));
        if (!unitId) {
          issues.error(n, 'not_found', `Unit "${v(row, 'unit')}" not found`, 'unit');
          continue;
        }
        try {
          factor = await this.productsService.unitFactor(tenantId, product.id, unitId);
        } catch (err) {
          issues.error(n, 'unit_not_defined', (err as Error).message, 'unit');
          continue;
        }
      }
      const quantity = round(Number(v(row, 'quantity')) * factor, 4);
      const unitCost = has(row, 'unitCost')
        ? round(Number(v(row, 'unitCost')) / factor, 4)
        : Number(product.costPrice || 0);
      if (!has(row, 'unitCost')) {
        issues.warning(n, 'default_cost', `No unit cost; the current cost ${unitCost} is used`, 'unitCost');
      }

      let lots: StockPlan['lots'];
      const tracked = product.trackingType !== TrackingType.NONE;
      if (!tracked && (has(row, 'lotNumber') || has(row, 'expiryDate'))) {
        issues.error(n, 'not_tracked', `Product ${product.code} is not lot/serial tracked`, 'lotNumber');
        continue;
      }
      if (tracked) {
        const serial = product.trackingType === TrackingType.SERIAL;
        if (serial && !Number.isInteger(quantity)) {
          issues.error(n, 'serial_quantity', 'Serial-tracked products need a whole quantity', 'quantity');
          continue;
        }
        if (has(row, 'lotNumber')) {
          if (serial && quantity !== 1) {
            issues.error(n, 'serial_quantity', 'A row with a serial number must have quantity 1', 'quantity');
            continue;
          }
          if (serial) {
            const key = `${product.id}:${keyOf(v(row, 'lotNumber'))}`;
            if (serials.has(key)) {
              issues.error(n, 'duplicate_in_file', `Serial ${v(row, 'lotNumber')} is repeated`, 'lotNumber');
              continue;
            }
            serials.add(key);
          }
          lots = [{ lotNumber: String(v(row, 'lotNumber')), quantity, expiryDate: v(row, 'expiryDate') ?? null }];
        } else {
          issues.warning(n, 'auto_lot', 'No lot number; an automatic lot is created', 'lotNumber');
        }
        if (product.hasExpiry && !has(row, 'expiryDate')) {
          issues.error(n, 'required', `Expiry date is required for product ${product.code}`, 'expiryDate');
          continue;
        }
        if (product.hasExpiry && !has(row, 'lotNumber')) {
          issues.error(n, 'required', 'Give a lot number with the expiry date', 'lotNumber');
          continue;
        }
      }

      const pair = `${product.id}:${warehouse.id}`;
      if ((onHand.get(pair) ?? 0) !== 0 && !warned.has(pair)) {
        warned.add(pair);
        issues.warning(
          n,
          'existing_stock',
          `${product.code} already has ${onHand.get(pair)} in ${warehouse.code}; the quantity is added to it`,
          'quantity',
        );
      }
      const value = round(quantity * unitCost, 4);
      totalValue = round(totalValue + value, 4);
      planned.push({
        row,
        action: 'create',
        data: { productId: product.id, productCode: product.code, warehouseId: warehouse.id, quantity, unitCost, value, lots },
      });
    }

    const outcome: ValidationOutcome<StockPlan> & StockOutcomeExtra = {
      planned,
      issues: issues.items,
      summary: { date, totalValue, offsetAccountCode: offset.code ?? null, posted: !!offset.accountId },
      offset,
      totalValue,
    };
    return outcome;
  }

  async commit(ctx: ImportContext, outcome: ValidationOutcome<StockPlan>): Promise<Record<string, unknown>> {
    const { tenantId, userId, jobId } = ctx;
    const { offset, totalValue } = outcome as ValidationOutcome<StockPlan> & StockOutcomeExtra;
    const date = openingDate(ctx);
    for (const item of outcome.planned) {
      if (item.action !== 'create') continue;
      await this.stockService.receive(tenantId, userId, {
        productId: item.data.productId,
        warehouseId: item.data.warehouseId,
        quantity: item.data.quantity,
        unitCost: item.data.unitCost,
        referenceType: 'opening_stock',
        referenceId: jobId,
        description: `Opening stock ${date}`,
        lots: item.data.lots,
      });
    }
    let journalEntryId: string | null = null;
    if (offset?.accountId && totalValue > 0) {
      const entry = await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Opening stock import ${date}`,
        sourceType: 'data_import',
        sourceId: jobId,
        buildLines: (_s, account) => [
          { accountId: account('inventoryAccountId'), debit: totalValue },
          { accountId: offset.accountId!, credit: totalValue },
        ],
      });
      journalEntryId = entry?.id ?? null;
    }
    return { received: outcome.planned.length, totalValue, journalEntryId };
  }
}
