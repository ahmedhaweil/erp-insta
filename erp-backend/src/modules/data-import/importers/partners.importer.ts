import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { CustomersService } from '@modules/sales/services/customers.service';
import { SuppliersService } from '@modules/purchasing/services/suppliers.service';
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

export const PARTNER_COLUMNS: ColumnSpec[] = [
  { key: 'code', label: { en: 'Code', ar: 'الكود' }, required: true, example: 'C-0001' },
  { key: 'nameAr', label: { en: 'Arabic name', ar: 'الاسم العربي' }, required: true, width: 30 },
  {
    key: 'nameEn',
    label: { en: 'English name', ar: 'الاسم الإنجليزي' },
    width: 30,
    note: { en: 'Defaults to the Arabic name', ar: 'الافتراضي الاسم العربي' },
  },
  { key: 'phone', label: { en: 'Phone', ar: 'الهاتف' } },
  { key: 'email', label: { en: 'Email', ar: 'البريد الإلكتروني' } },
  {
    key: 'taxId',
    label: { en: 'Tax registration number', ar: 'رقم التسجيل الضريبي' },
    note: { en: 'Egypt: 9 digits, Saudi: 15 digits', ar: 'مصر: 9 أرقام، السعودية: 15 رقمًا' },
  },
  { key: 'address', label: { en: 'Address', ar: 'العنوان' }, width: 30 },
  { key: 'city', label: { en: 'City', ar: 'المدينة' } },
  { key: 'country', label: { en: 'Country', ar: 'الدولة' }, example: 'EG' },
  { key: 'creditLimit', label: { en: 'Credit limit', ar: 'حد الائتمان' }, type: 'number', min: 0 },
  {
    key: 'paymentTermDays',
    label: { en: 'Payment terms (days)', ar: 'مدة السداد (يوم)' },
    type: 'integer',
    min: 0,
    max: 3650,
  },
  { key: 'isActive', label: { en: 'Active', ar: 'نشط' }, type: 'boolean' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PartnerPlan {
  id?: string;
  dto: Record<string, unknown>;
}

type PartnerRecord = Customer | Supplier;

/** Shared validation of customers and suppliers (upsert by code). */
abstract class PartnerImporter implements Importer<PartnerPlan> {
  abstract readonly entity: ImportEntity;
  abstract readonly title: { en: string; ar: string };
  readonly columns = PARTNER_COLUMNS;

  protected abstract findAll(tenantId: string): Promise<PartnerRecord[]>;
  protected abstract create(tenantId: string, dto: Record<string, unknown>): Promise<unknown>;
  protected abstract update(tenantId: string, id: string, dto: Record<string, unknown>): Promise<unknown>;
  /** Defaults for NOT NULL columns of a new record. */
  protected abstract defaults(): Record<string, unknown>;

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<PartnerPlan>> {
    const issues = new IssueList();
    checkDuplicateCodes(rows, issues);
    const existing = new Map((await this.findAll(ctx.tenantId)).map((p) => [keyOf(p.code), p]));
    const taxIds = new Map<string, string>();
    for (const p of existing.values()) if (p.taxId) taxIds.set(keyOf(p.taxId), p.code);
    const planned: PlannedRow<PartnerPlan>[] = [];

    for (const row of rows) {
      const n = row.rowNumber;
      if (!has(row, 'code')) continue;
      const code = String(v(row, 'code'));
      const current = existing.get(keyOf(code));
      if (current && !ctx.options.updateExisting) {
        issues.warning(n, 'exists_skipped', `${code} already exists and is skipped`, 'code');
        planned.push({ row, action: 'skip', data: { dto: {} } });
        continue;
      }
      const dto: Record<string, unknown> = {};
      for (const col of this.columns) if (col.key !== 'code' && has(row, col.key)) dto[col.key] = v(row, col.key);
      if (dto.email && !EMAIL.test(String(dto.email))) {
        issues.error(n, 'invalid_email', `"${dto.email}" is not a valid email`, 'email');
      }
      if (dto.taxId) {
        const tax = String(dto.taxId).replace(/[\s-]/g, '');
        if (!/^\d+$/.test(tax)) issues.warning(n, 'tax_id_format', 'Tax number should contain digits only', 'taxId');
        dto.taxId = tax;
        const owner = taxIds.get(keyOf(tax));
        if (owner && keyOf(owner) !== keyOf(code)) {
          issues.warning(n, 'tax_id_used', `Tax number is also used by ${owner}`, 'taxId');
        }
        taxIds.set(keyOf(tax), code);
      }
      if (current) {
        planned.push({ row, action: 'update', data: { id: current.id, dto } });
      } else {
        const full = { ...this.defaults(), ...dto, code };
        if (!full.nameEn) full.nameEn = full.nameAr;
        planned.push({ row, action: 'create', data: { dto: full } });
      }
    }
    return { planned, issues: issues.items };
  }

  async commit(ctx: ImportContext, outcome: ValidationOutcome<PartnerPlan>): Promise<Record<string, unknown>> {
    let created = 0;
    let updated = 0;
    for (const item of outcome.planned) {
      if (item.action === 'create') {
        await this.create(ctx.tenantId, item.data.dto);
        created++;
      } else if (item.action === 'update') {
        await this.update(ctx.tenantId, item.data.id!, item.data.dto);
        updated++;
      }
    }
    return { created, updated };
  }

  async exportRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const records = await this.findAll(tenantId);
    return records
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((p) => ({
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        phone: p.phone,
        email: p.email,
        taxId: p.taxId,
        address: p.address,
        city: p.city,
        country: p.country,
        creditLimit: Number(p.creditLimit),
        paymentTermDays: p.paymentTermDays,
        isActive: p.isActive,
      }));
  }
}

@Injectable()
export class CustomersImporter extends PartnerImporter {
  readonly entity = ImportEntity.CUSTOMERS;
  readonly title = { en: 'Customers', ar: 'العملاء' };

  constructor(
    @InjectRepository(Customer) private readonly repo: Repository<Customer>,
    private readonly customers: CustomersService,
  ) {
    super();
  }

  protected findAll(tenantId: string) {
    return this.repo.find({ where: { tenantId } });
  }
  protected create(tenantId: string, dto: Record<string, unknown>) {
    return this.customers.create(tenantId, dto as any);
  }
  protected update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.customers.update(tenantId, id, dto as any);
  }
  protected defaults() {
    return { phone: '' };
  }
}

@Injectable()
export class SuppliersImporter extends PartnerImporter {
  readonly entity = ImportEntity.SUPPLIERS;
  readonly title = { en: 'Suppliers', ar: 'الموردون' };

  constructor(
    @InjectRepository(Supplier) private readonly repo: Repository<Supplier>,
    private readonly suppliers: SuppliersService,
  ) {
    super();
  }

  protected findAll(tenantId: string) {
    return this.repo.find({ where: { tenantId } });
  }
  protected create(tenantId: string, dto: Record<string, unknown>) {
    return this.suppliers.create(tenantId, dto as any);
  }
  protected update(tenantId: string, id: string, dto: Record<string, unknown>) {
    return this.suppliers.update(tenantId, id, dto as any);
  }
  protected defaults() {
    return { phone: '', address: '', city: '', country: '' };
  }
}
