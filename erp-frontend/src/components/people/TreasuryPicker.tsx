'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePeopleQuery, useLocalName } from '@/hooks/use-people';
import { lookupsService } from '@/services/people-lookups.service';
import { Field, Select, useMoney } from './ui';
import type { HrPaymentMethod } from '@/services/people-hr.service';

/**
 * Optional cash box / bank account to pay from (treasuryId). Lists only the
 * treasuries the current user may use (custodian or "all treasuries"
 * permission) of the type matching the payment method; empty = the default
 * cash / bank account of the accounting settings.
 */
export default function TreasuryPicker({
  method,
  value,
  onChange,
}: {
  method: HrPaymentMethod;
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('hr');
  const name = useLocalName();
  const money = useMoney();
  const { data: treasuries = [], isLoading } = usePeopleQuery(['people-treasuries', 'usable'], lookupsService.usableTreasuries);
  const options = treasuries.filter((tr) => tr.isActive !== false && tr.type === method);

  // Drop a selection that does not match the method any more.
  useEffect(() => {
    if (value && !options.some((o) => o.id === value)) onChange('');
  }, [method, value, options, onChange]);

  return (
    <Field label={method === 'cash' ? t('payFromCashBox') : t('payFromBank')} hint={isLoading ? undefined : options.length ? t('treasuryHint') : t('noUsableTreasury')}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('defaultTreasury')}
        options={options.map((tr) => ({
          value: tr.id,
          label: `${tr.code} - ${name(tr)}${tr.balance != null ? ` (${money(tr.balance)})` : ''}`,
        }))}
      />
    </Field>
  );
}
