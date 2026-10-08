import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductType, TrackingType } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { Unit } from '@modules/inventory/entities/unit.entity';
import { ProductUnit } from '@modules/inventory/entities/product-unit.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { ProductsService } from '@modules/inventory/services/products.service';
import { CreateProductDto } from '@modules/inventory/dto/create-product.dto';
import { ImportEntity } from '../entities/import-job.entity';
import type { ColumnSpec, ParsedRow } from '../utils/spreadsheet.util';
import {
  ImportContext,
  Importer,
  IssueList,
  PlannedRow,
  ValidationOutcome,
  checkDuplicateCodes,
  has,
  keyOf,
  v,
} from './importer.types';

export const ALT_UNIT_SLOTS = [1, 2, 3];

const altUnitColumns = (n: number): ColumnSpec[] => [
  {
    key: `altUnit${n}`,
    label: { en: `Alternate unit ${n}`, ar: `وحدة بديلة ${n}` },
    note: { en: 'Unit name or symbol (e.g. carton)', ar: 'اسم الوحدة أو رمزها (مثل كرتونة)' },
  },
  {
    key: `altUnit${n}Factor`,
    label: { en: `Alternate unit ${n} factor`, ar: `معامل الوحدة البديلة ${n}` },
    type: 'number',
    min: 0.000001,
    note: { en: 'Base units in one alternate unit', ar: 'عدد الوحدات الأساسية في الوحدة البديلة' },
  },
  { key: `altUnit${n}Barcode`, label: { en: `Alternate unit ${n} barcode`, ar: `باركود الوحدة البديلة ${n}` } },
  {
    key: `altUnit${n}Price`,
    label: { en: `Alternate unit ${n} price`, ar: `سعر الوحدة البديلة ${n}` },
    type: 'number',
    min: 0,
  },
];

export const PRODUCT_COLUMNS: ColumnSpec[] = [
  { key: 'code', label: { en: 'Code', ar: 'الكود' }, required: true, example: 'P-0001' },
  { key: 'nameAr', label: { en: 'Arabic name', ar: 'الاسم العربي' }, required: true, width: 30 },
  { key: 'nameEn', label: { en: 'English name', ar: 'الاسم الإنجليزي' }, width: 30 },
  {
    key: 'type',
    label: { en: 'Type', ar: 'النوع' },
    type: 'enum',
    values: [
      { value: ProductType.GOODS, aliases: ['مخزني', 'سلعة', 'بضاعة', 'منتج', 'stock', 'product'] },
      { value: ProductType.SERVICE, aliases: ['خدمة', 'خدمي'] },
    ],
    note: { en: 'Default goods', ar: 'الافتراضي مخزني' },
  },
  {
    key: 'category',
    label: { en: 'Category', ar: 'التصنيف' },
    note: { en: 'Category name (Arabic or English)', ar: 'اسم التصنيف (عربي أو إنجليزي)' },
  },
  {
    key: 'unit',
    label: { en: 'Base unit', ar: 'الوحدة الأساسية' },
    note: { en: 'Unit name or symbol', ar: 'اسم الوحدة أو رمزها' },
  },
  { key: 'barcode', label: { en: 'Barcode', ar: 'الباركود' } },
  { key: 'sku', label: { en: 'SKU', ar: 'رمز الصنف' } },
  { key: 'costPrice', label: { en: 'Cost price', ar: 'سعر التكلفة' }, type: 'number', min: 0 },
  { key: 'sellPrice', label: { en: 'Sell price', ar: 'سعر البيع' }, type: 'number', min: 0 },
  { key: 'minSellPrice', label: { en: 'Minimum sell price', ar: 'أقل سعر بيع' }, type: 'number', min: 0 },
  { key: 'salesTaxRate', label: { en: 'Sales tax %', ar: 'ضريبة المبيعات %' }, type: 'number', min: 0, max: 100 },
  {
    key: 'purchaseTaxRate',
    label: { en: 'Purchase tax %', ar: 'ضريبة المشتريات %' },
    type: 'number',
    min: 0,
    max: 100,
  },
  { key: 'reorderLevel', label: { en: 'Reorder level', ar: 'حد الطلب' }, type: 'number', min: 0 },
  { key: 'reorderQty', label: { en: 'Reorder quantity', ar: 'كمية الطلب' }, type: 'number', min: 0 },
  {
    key: 'trackingType',
    label: { en: 'Tracking', ar: 'التتبع' },
    type: 'enum',
    values: [
      { value: TrackingType.NONE, aliases: ['بدون', 'لا يوجد'] },
      { value: TrackingType.LOT, aliases: ['تشغيلة', 'دفعة', 'batch'] },
      { value: TrackingType.SERIAL, aliases: ['سيريال', 'رقم تسلسلي'] },
    ],
  },
  { key: 'hasExpiry', label: { en: 'Has expiry', ar: 'له تاريخ صلاحية' }, type: 'boolean' },
  {
    key: 'preferredSupplierCode',
    label: { en: 'Preferred supplier code', ar: 'كود المورد المفضل' },
  },
  { key: 'description', label: { en: 'Description', ar: 'الوصف' }, width: 30 },
  { key: 'isActive', label: { en: 'Active', ar: 'نشط' }, type: 'boolean' },
  ...ALT_UNIT_SLOTS.flatMap(altUnitColumns),
];

interface ProductPlan {
  productId?: string;
  dto: Partial<CreateProductDto>;
  /** Names of categories / units to create first (createMissing). */
  categoryKey?: string;
  unitKey?: string;
  altUnits: { unitKey: string; unitId?: string; factor: number; barcode?: string; sellPrice?: number }[];
}

interface ProductsOutcomeExtra {
  newCategories: Map<string, string>;
  newUnits: Map<string, string>;
}

@Injectable()
export class ProductsImporter implements Importer<ProductPlan> {
  readonly entity = ImportEntity.PRODUCTS;
  readonly title = { en: 'Products', ar: 'الأصناف' };
  readonly columns = PRODUCT_COLUMNS;

  constructor(
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    @InjectRepository(ProductUnit) private readonly productUnitRepo: Repository<ProductUnit>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    private readonly productsService: ProductsService,
  ) {}

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<ProductPlan>> {
    const { tenantId, options } = ctx;
    const issues = new IssueList();
    checkDuplicateCodes(rows, issues);

    const [products, categories, units, productUnits, suppliers] = await Promise.all([
      this.productRepo.find({ where: { tenantId } }),
      this.categoryRepo.find({ where: { tenantId } }),
      this.unitRepo.find({ where: { tenantId } }),
      this.productUnitRepo.find({ where: { tenantId } }),
      this.supplierRepo.find({ where: { tenantId } }),
    ]);
    const productByCode = new Map(products.map((p) => [keyOf(p.code), p]));
    const productById = new Map(products.map((p) => [p.id, p]));
    const categoryByName = new Map<string, string>();
    for (const c of categories) {
      for (const n of [c.nameAr, c.nameEn]) if (n && !categoryByName.has(keyOf(n))) categoryByName.set(keyOf(n), c.id);
    }
    const unitByName = new Map<string, string>();
    for (const u of units) {
      for (const n of [u.symbol, u.nameAr, u.nameEn]) if (n && !unitByName.has(keyOf(n))) unitByName.set(keyOf(n), u.id);
    }
    const supplierByCode = new Map(suppliers.map((s) => [keyOf(s.code), s.id]));
    // Barcodes already used in the database -> owning product id
    const barcodeOwner = new Map<string, string>();
    for (const p of products) if (p.barcode) barcodeOwner.set(keyOf(p.barcode), p.id);
    for (const pu of productUnits) if (pu.barcode) barcodeOwner.set(keyOf(pu.barcode), pu.productId);
    const fileBarcodes = new Map<string, number>();

    const newCategories = new Map<string, string>();
    const newUnits = new Map<string, string>();
    const planned: PlannedRow<ProductPlan>[] = [];

    const resolveUnit = (row: ParsedRow, column: string): { id?: string; key?: string } | null => {
      const name = String(v(row, column));
      const id = unitByName.get(keyOf(name));
      if (id) return { id };
      if (options.createMissing) {
        if (!newUnits.has(keyOf(name))) {
          newUnits.set(keyOf(name), name);
          issues.warning(row.rowNumber, 'will_create', `Unit "${name}" will be created`, column);
        }
        return { key: keyOf(name) };
      }
      issues.error(row.rowNumber, 'not_found', `Unit "${name}" not found (enable "create missing")`, column);
      return null;
    };

    const checkBarcode = (row: ParsedRow, column: string, barcode: string, selfId?: string) => {
      const k = keyOf(barcode);
      const at = fileBarcodes.get(k);
      if (at !== undefined) {
        issues.error(row.rowNumber, 'duplicate_in_file', `Barcode ${barcode} already appears on row ${at}`, column);
        return;
      }
      fileBarcodes.set(k, row.rowNumber);
      const owner = barcodeOwner.get(k);
      if (owner && owner !== selfId) {
        const other = productById.get(owner);
        issues.error(row.rowNumber, 'barcode_used', `Barcode ${barcode} is used by product ${other?.code ?? owner}`, column);
      }
    };

    for (const row of rows) {
      const n = row.rowNumber;
      const code = has(row, 'code') ? String(v(row, 'code')) : '';
      if (!code) continue;
      const existing = productByCode.get(keyOf(code));
      if (existing && !options.updateExisting) {
        issues.warning(n, 'exists_skipped', `Product ${code} already exists and is skipped`, 'code');
        planned.push({ row, action: 'skip', data: { dto: {}, altUnits: [] } });
        continue;
      }

      const dto: Partial<CreateProductDto> = { code };
      const plan: ProductPlan = { productId: existing?.id, dto, altUnits: [] };
      const copy: (keyof CreateProductDto)[] = [
        'nameAr',
        'nameEn',
        'type',
        'barcode',
        'sku',
        'costPrice',
        'sellPrice',
        'minSellPrice',
        'salesTaxRate',
        'purchaseTaxRate',
        'reorderLevel',
        'reorderQty',
        'trackingType',
        'hasExpiry',
        'description',
        'isActive',
      ];
      for (const key of copy) if (has(row, key)) (dto as any)[key] = v(row, key);
      if (!existing && !dto.type) dto.type = ProductType.GOODS;

      // Category
      if (has(row, 'category')) {
        const name = String(v(row, 'category'));
        const id = categoryByName.get(keyOf(name));
        if (id) dto.categoryId = id;
        else if (options.createMissing) {
          plan.categoryKey = keyOf(name);
          if (!newCategories.has(plan.categoryKey)) {
            newCategories.set(plan.categoryKey, name);
            issues.warning(n, 'will_create', `Category "${name}" will be created`, 'category');
          }
        } else {
          issues.error(n, 'not_found', `Category "${name}" not found (enable "create missing")`, 'category');
        }
      } else if (!existing) {
        issues.error(n, 'required', 'Category is required for a new product', 'category');
      }

      // Base unit
      if (has(row, 'unit')) {
        const unit = resolveUnit(row, 'unit');
        if (unit?.id) dto.unitId = unit.id;
        if (unit?.key) plan.unitKey = unit.key;
        if (existing && unit && (unit.key || unit.id !== existing.unitId)) {
          issues.error(n, 'unit_change', 'The base unit of an existing product cannot be changed by import', 'unit');
        }
      } else if (!existing) {
        issues.error(n, 'required', 'Base unit is required for a new product', 'unit');
      }

      if (dto.barcode) checkBarcode(row, 'barcode', dto.barcode, existing?.id);

      const tracking = dto.trackingType ?? existing?.trackingType ?? TrackingType.NONE;
      const hasExpiry = dto.hasExpiry ?? existing?.hasExpiry ?? false;
      if (hasExpiry && tracking === TrackingType.NONE) {
        issues.error(n, 'expiry_needs_tracking', 'Expiry dates require lot or serial tracking', 'hasExpiry');
      }
      if (existing && dto.trackingType && dto.trackingType !== existing.trackingType) {
        issues.warning(n, 'tracking_change', 'Changing the tracking of a product with stock may leave lots inconsistent', 'trackingType');
      }
      if ((dto.type ?? existing?.type) === ProductType.SERVICE && tracking !== TrackingType.NONE) {
        issues.error(n, 'service_tracking', 'Services cannot be lot or serial tracked', 'trackingType');
      }

      if (has(row, 'preferredSupplierCode')) {
        const sid = supplierByCode.get(keyOf(v(row, 'preferredSupplierCode')));
        if (sid) dto.preferredSupplierId = sid;
        else issues.error(n, 'not_found', `Supplier ${v(row, 'preferredSupplierCode')} not found`, 'preferredSupplierCode');
      }

      for (const slot of ALT_UNIT_SLOTS) {
        const col = `altUnit${slot}`;
        if (!has(row, col)) {
          if (has(row, `${col}Factor`) || has(row, `${col}Barcode`) || has(row, `${col}Price`)) {
            issues.error(n, 'required', `Alternate unit ${slot} name is missing`, col);
          }
          continue;
        }
        if (!has(row, `${col}Factor`)) {
          issues.error(n, 'required', `Alternate unit ${slot} needs a factor`, `${col}Factor`);
          continue;
        }
        const unit = resolveUnit(row, col);
        if (!unit) continue;
        const baseId = dto.unitId ?? existing?.unitId;
        const sameAsBase = unit.id ? unit.id === baseId : unit.key === plan.unitKey;
        if (sameAsBase) {
          issues.error(n, 'alt_is_base', `Alternate unit ${slot} is the base unit`, col);
          continue;
        }
        if (plan.altUnits.some((a) => (unit.id ? a.unitId === unit.id : a.unitKey === unit.key))) {
          issues.error(n, 'duplicate_unit', `Alternate unit ${slot} is listed twice`, col);
          continue;
        }
        const barcode = has(row, `${col}Barcode`) ? String(v(row, `${col}Barcode`)) : undefined;
        if (barcode) checkBarcode(row, `${col}Barcode`, barcode, existing?.id);
        plan.altUnits.push({
          unitKey: unit.key ?? '',
          unitId: unit.id,
          factor: Number(v(row, `${col}Factor`)),
          barcode,
          sellPrice: has(row, `${col}Price`) ? Number(v(row, `${col}Price`)) : undefined,
        });
      }

      planned.push({ row, action: existing ? 'update' : 'create', data: plan });
    }

    const outcome: ValidationOutcome<ProductPlan> & ProductsOutcomeExtra = {
      planned,
      issues: issues.items,
      summary: {
        newCategories: [...newCategories.values()],
        newUnits: [...newUnits.values()],
      },
      newCategories,
      newUnits,
    };
    return outcome;
  }

  async commit(ctx: ImportContext, outcome: ValidationOutcome<ProductPlan>): Promise<Record<string, unknown>> {
    const { tenantId } = ctx;
    const extra = outcome as ValidationOutcome<ProductPlan> & ProductsOutcomeExtra;
    const categoryIds = new Map<string, string>();
    for (const [key, name] of extra.newCategories ?? new Map()) {
      const saved = await this.categoryRepo.save(
        this.categoryRepo.create({ tenantId, nameAr: name, nameEn: name, level: 0 }),
      );
      categoryIds.set(key, saved.id);
    }
    const unitIds = new Map<string, string>();
    for (const [key, name] of extra.newUnits ?? new Map()) {
      const saved = await this.unitRepo.save(
        this.unitRepo.create({ tenantId, nameAr: name, nameEn: name, symbol: name, conversionFactor: 1 }),
      );
      unitIds.set(key, saved.id);
    }

    let created = 0;
    let updated = 0;
    for (const item of outcome.planned) {
      if (item.action === 'skip') continue;
      const { dto, categoryKey, unitKey } = item.data;
      if (categoryKey) dto.categoryId = categoryIds.get(categoryKey);
      if (unitKey) dto.unitId = unitIds.get(unitKey);
      let productId = item.data.productId;
      if (item.action === 'create') {
        const product = await this.productsService.create(tenantId, dto as CreateProductDto);
        productId = product.id;
        created++;
      } else {
        const { code: _code, ...changes } = dto;
        await this.productsService.update(tenantId, productId!, changes);
        updated++;
      }
      for (const alt of item.data.altUnits) {
        await this.productsService.upsertUnit(tenantId, productId!, {
          unitId: alt.unitId ?? unitIds.get(alt.unitKey)!,
          factor: alt.factor,
          barcode: alt.barcode,
          sellPrice: alt.sellPrice,
        });
      }
    }
    return { created, updated, categoriesCreated: categoryIds.size, unitsCreated: unitIds.size };
  }

  async exportRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const [products, productUnits, suppliers] = await Promise.all([
      this.productRepo.find({ where: { tenantId }, relations: ['category', 'unit'], order: { code: 'ASC' } }),
      this.productUnitRepo.find({ where: { tenantId }, relations: ['unit'], order: { factor: 'ASC' } }),
      this.supplierRepo.find({ where: { tenantId } }),
    ]);
    const supplierCode = new Map(suppliers.map((s) => [s.id, s.code]));
    const altByProduct = new Map<string, ProductUnit[]>();
    for (const pu of productUnits) {
      const list = altByProduct.get(pu.productId) ?? [];
      list.push(pu);
      altByProduct.set(pu.productId, list);
    }
    return products.map((p) => {
      const row: Record<string, unknown> = {
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        type: p.type,
        category: p.category?.nameAr ?? p.category?.nameEn,
        unit: p.unit?.symbol || p.unit?.nameAr,
        barcode: p.barcode,
        sku: p.sku,
        costPrice: Number(p.costPrice),
        sellPrice: Number(p.sellPrice),
        minSellPrice: p.minSellPrice === null || p.minSellPrice === undefined ? null : Number(p.minSellPrice),
        salesTaxRate: Number(p.salesTaxRate),
        purchaseTaxRate: Number(p.purchaseTaxRate),
        reorderLevel: Number(p.reorderLevel),
        reorderQty: Number(p.reorderQty),
        trackingType: p.trackingType,
        hasExpiry: p.hasExpiry,
        preferredSupplierCode: p.preferredSupplierId ? supplierCode.get(p.preferredSupplierId) : null,
        description: p.description,
        isActive: p.isActive,
      };
      (altByProduct.get(p.id) ?? []).slice(0, ALT_UNIT_SLOTS.length).forEach((pu, i) => {
        const col = `altUnit${i + 1}`;
        row[col] = pu.unit?.symbol || pu.unit?.nameAr;
        row[`${col}Factor`] = Number(pu.factor);
        row[`${col}Barcode`] = pu.barcode;
        row[`${col}Price`] = pu.sellPrice === null ? null : Number(pu.sellPrice);
      });
      return row;
    });
  }
}
