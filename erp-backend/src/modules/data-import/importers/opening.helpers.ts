import { Repository } from 'typeorm';
import { Account } from '@modules/accounting/entities/account.entity';
import { AccountingSettings } from '@modules/accounting/entities/accounting-settings.entity';
import type { SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { today } from '@shared/utils/document-totals.util';
import { ImportContext, IssueList, keyOf } from './importer.types';

export interface OffsetAccount {
  /** null when automatic accounting is disabled (nothing is posted). */
  accountId: string | null;
  code?: string;
  source: 'request' | 'settings' | 'none';
}

/**
 * Resolves the opening-equity (offset) account of an opening import: the
 * account given in the request (id or code) or, failing that, the default
 * settings account `fallbackKey`. Issues are reported on row 0 (file level).
 */
export async function resolveOffsetAccount(
  ctx: ImportContext,
  accountRepo: Repository<Account>,
  settings: AccountingSettings | null,
  fallbackKey: SettingsAccountKey,
  issues: IssueList,
): Promise<OffsetAccount> {
  const { offsetAccountId, offsetAccountCode } = ctx.options;
  if (!settings) {
    if (offsetAccountId || offsetAccountCode) {
      issues.warning(0, 'accounting_disabled', 'Automatic accounting is not configured; no journal entry is posted');
    }
    return { accountId: null, source: 'none' };
  }
  if (offsetAccountId || offsetAccountCode) {
    const account = offsetAccountId
      ? await accountRepo.findOne({ where: { tenantId: ctx.tenantId, id: offsetAccountId } })
      : (await accountRepo.find({ where: { tenantId: ctx.tenantId } })).find(
          (a) => keyOf(a.code) === keyOf(offsetAccountCode),
        );
    if (!account) {
      issues.error(0, 'offset_not_found', `Offset account ${offsetAccountCode ?? offsetAccountId} not found`);
      return { accountId: null, source: 'request' };
    }
    if (!account.isActive || !account.allowPosting) {
      issues.error(0, 'offset_not_postable', `Offset account ${account.code} is inactive or does not accept postings`);
    }
    return { accountId: account.id, code: account.code, source: 'request' };
  }
  const id = settings[fallbackKey] as string | undefined;
  if (!id) {
    issues.error(0, 'offset_missing', `Give an offset account: accounting settings have no "${fallbackKey}"`);
    return { accountId: null, source: 'settings' };
  }
  const account = await accountRepo.findOne({ where: { tenantId: ctx.tenantId, id } });
  issues.warning(
    0,
    'offset_default',
    `No offset account given; the opening entry is posted against ${account?.code ?? id} (${fallbackKey})`,
  );
  return { accountId: id, code: account?.code, source: 'settings' };
}

export function openingDate(ctx: ImportContext): string {
  return ctx.options.date || today();
}
