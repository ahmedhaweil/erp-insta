import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, AccountType } from '@modules/accounting/entities/account.entity';
import { AccountsService } from '@modules/accounting/services/accounts.service';
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

export const ACCOUNT_COLUMNS: ColumnSpec[] = [
  { key: 'code', label: { en: 'Account code', ar: 'رقم الحساب' }, required: true, example: '1101' },
  { key: 'nameAr', label: { en: 'Arabic name', ar: 'الاسم العربي' }, required: true, width: 32 },
  { key: 'nameEn', label: { en: 'English name', ar: 'الاسم الإنجليزي' }, width: 32 },
  {
    key: 'type',
    label: { en: 'Type', ar: 'النوع' },
    type: 'enum',
    values: [
      { value: AccountType.ASSET, aliases: ['أصول', 'اصول', 'أصل', 'assets'] },
      { value: AccountType.LIABILITY, aliases: ['خصوم', 'التزامات', 'liabilities'] },
      { value: AccountType.EQUITY, aliases: ['حقوق ملكية', 'حقوق الملكية', 'رأس المال'] },
      { value: AccountType.REVENUE, aliases: ['إيرادات', 'ايرادات', 'income', 'revenues'] },
      { value: AccountType.EXPENSE, aliases: ['مصروفات', 'مصاريف', 'expenses'] },
    ],
    note: { en: 'Defaults to the parent account type', ar: 'الافتراضي نوع الحساب الأب' },
  },
  {
    key: 'parentCode',
    label: { en: 'Parent account code', ar: 'رقم الحساب الأب' },
    note: { en: 'Parent may be in the file or already exist', ar: 'يمكن أن يكون الأب في الملف أو موجودًا مسبقًا' },
  },
  {
    key: 'allowPosting',
    label: { en: 'Allow posting', ar: 'يقبل القيود' },
    type: 'boolean',
    note: { en: 'Default: yes when no other row has it as parent', ar: 'الافتراضي نعم إذا لم يكن أبًا لحساب آخر' },
  },
  { key: 'description', label: { en: 'Description', ar: 'الوصف' }, width: 30 },
  { key: 'isActive', label: { en: 'Active', ar: 'نشط' }, type: 'boolean' },
];

interface AccountPlan {
  id?: string;
  code: string;
  parentCode?: string;
  dto: Record<string, unknown>;
}

/** Chart of accounts, upserted by code; parents are created before children. */
@Injectable()
export class AccountsImporter implements Importer<AccountPlan> {
  readonly entity = ImportEntity.ACCOUNTS;
  readonly title = { en: 'Chart of accounts', ar: 'دليل الحسابات' };
  readonly columns = ACCOUNT_COLUMNS;

  constructor(
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    private readonly accounts: AccountsService,
  ) {}

  async validate(ctx: ImportContext, rows: ParsedRow[]): Promise<ValidationOutcome<AccountPlan>> {
    const issues = new IssueList();
    checkDuplicateCodes(rows, issues);
    const existing = await this.accountRepo.find({ where: { tenantId: ctx.tenantId } });
    const byCode = new Map(existing.map((a) => [keyOf(a.code), a]));
    const byId = new Map(existing.map((a) => [a.id, a]));
    const fileRows = new Map<string, ParsedRow>();
    for (const row of rows) if (has(row, 'code') && !fileRows.has(keyOf(v(row, 'code')))) fileRows.set(keyOf(v(row, 'code')), row);
    const parentsInFile = new Set(rows.filter((r) => has(r, 'parentCode')).map((r) => keyOf(v(r, 'parentCode'))));

    // Resolve the type of a code from the file (walking up parents) or the database.
    const typeOf = (code: string, seen = new Set<string>()): AccountType | undefined => {
      const k = keyOf(code);
      if (seen.has(k)) return undefined;
      seen.add(k);
      const row = fileRows.get(k);
      if (row) {
        if (has(row, 'type')) return v(row, 'type');
        if (has(row, 'parentCode')) return typeOf(String(v(row, 'parentCode')), seen);
      }
      return byCode.get(k)?.type;
    };

    const planned: PlannedRow<AccountPlan>[] = [];
    for (const row of rows) {
      const n = row.rowNumber;
      if (!has(row, 'code')) continue;
      const code = String(v(row, 'code'));
      const current = byCode.get(keyOf(code));
      if (current && !ctx.options.updateExisting) {
        issues.warning(n, 'exists_skipped', `Account ${code} already exists and is skipped`, 'code');
        planned.push({ row, action: 'skip', data: { code, dto: {} } });
        continue;
      }
      const dto: Record<string, unknown> = {};
      for (const key of ['nameAr', 'nameEn', 'type', 'allowPosting', 'description', 'isActive']) {
        if (has(row, key)) dto[key] = v(row, key);
      }
      const parentCode = has(row, 'parentCode') ? String(v(row, 'parentCode')) : undefined;
      if (parentCode) {
        if (keyOf(parentCode) === keyOf(code)) {
          issues.error(n, 'self_parent', 'An account cannot be its own parent', 'parentCode');
        } else if (!fileRows.has(keyOf(parentCode)) && !byCode.has(keyOf(parentCode))) {
          issues.error(n, 'not_found', `Parent account ${parentCode} not found`, 'parentCode');
        } else if (this.hasCycle(code, fileRows, byCode, byId)) {
          issues.error(n, 'cycle', 'Parent accounts form a loop', 'parentCode');
        } else {
          const parentType = typeOf(parentCode);
          const type = (dto.type as AccountType | undefined) ?? parentType;
          if (dto.type && parentType && dto.type !== parentType) {
            issues.warning(n, 'type_differs', `Type ${dto.type} differs from the parent type ${parentType}`, 'type');
          }
          if (!dto.type && type && !current) dto.type = type;
          const parentRecord = byCode.get(keyOf(parentCode));
          if (parentRecord && parentRecord.allowPosting && !fileRows.has(keyOf(parentCode))) {
            issues.warning(n, 'parent_postable', `Parent ${parentCode} accepts postings; consider making it a header account`, 'parentCode');
          }
        }
      }
      if (!current && !dto.type) {
        issues.error(n, 'required', 'Type is required for a top-level account', 'type');
      }
      if (current) {
        const currentParent = current.parentId ? byId.get(current.parentId)?.code : undefined;
        if (parentCode !== undefined && keyOf(parentCode) !== keyOf(currentParent)) {
          issues.warning(n, 'parent_kept', 'The parent of an existing account is not changed by import', 'parentCode');
        }
        if (dto.type && dto.type !== current.type) {
          issues.warning(n, 'type_change', `Type changes from ${current.type} to ${dto.type}`, 'type');
        }
      }
      if (dto.allowPosting === undefined && !current) dto.allowPosting = !parentsInFile.has(keyOf(code));
      planned.push({
        row,
        action: current ? 'update' : 'create',
        data: { id: current?.id, code, parentCode, dto },
      });
    }
    return { planned, issues: issues.items };
  }

  private hasCycle(
    code: string,
    fileRows: Map<string, ParsedRow>,
    byCode: Map<string, Account>,
    byId: Map<string, Account>,
  ): boolean {
    const seen = new Set<string>();
    let k: string | undefined = keyOf(code);
    while (k) {
      if (seen.has(k)) return true;
      seen.add(k);
      // Existing accounts keep their parent; new ones take it from the file.
      const acc = byCode.get(k);
      if (acc) {
        const parent = acc.parentId ? byId.get(acc.parentId) : undefined;
        k = parent ? keyOf(parent.code) : undefined;
      } else {
        const row = fileRows.get(k);
        k = row && has(row, 'parentCode') ? keyOf(v(row, 'parentCode')) : undefined;
      }
    }
    return false;
  }

  async commit(ctx: ImportContext, outcome: ValidationOutcome<AccountPlan>): Promise<Record<string, unknown>> {
    const { tenantId } = ctx;
    const ids = new Map(
      (await this.accountRepo.find({ where: { tenantId } })).map((a) => [keyOf(a.code), a.id]),
    );
    // Create in dependency order: an account waits until its parent exists.
    const pending = outcome.planned.filter((p) => p.action === 'create');
    let created = 0;
    while (pending.length) {
      const ready = pending.findIndex((p) => !p.data.parentCode || ids.has(keyOf(p.data.parentCode)));
      if (ready < 0) throw new Error('Unresolvable account hierarchy');
      const [item] = pending.splice(ready, 1);
      const parentId = item.data.parentCode ? ids.get(keyOf(item.data.parentCode)) : undefined;
      const account = await this.accounts.create(tenantId, {
        ...(item.data.dto as any),
        code: item.data.code,
        parentId,
      });
      ids.set(keyOf(item.data.code), account.id);
      created++;
    }
    let updated = 0;
    for (const item of outcome.planned) {
      if (item.action !== 'update') continue;
      const { type, nameAr, nameEn, allowPosting, description, isActive } = item.data.dto as any;
      const changes = Object.fromEntries(
        Object.entries({ type, nameAr, nameEn, allowPosting, description, isActive }).filter(([, x]) => x !== undefined),
      );
      await this.accounts.update(tenantId, item.data.id!, changes);
      updated++;
    }
    return { created, updated };
  }

  async exportRows(tenantId: string): Promise<Record<string, unknown>[]> {
    const accounts = await this.accountRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
    const codeById = new Map(accounts.map((a) => [a.id, a.code]));
    return accounts.map((a) => ({
      code: a.code,
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      type: a.type,
      parentCode: a.parentId ? codeById.get(a.parentId) : null,
      allowPosting: a.allowPosting,
      description: a.description,
      isActive: a.isActive,
    }));
  }
}
