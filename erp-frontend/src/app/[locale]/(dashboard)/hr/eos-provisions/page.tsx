'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import { Field, FormActions, Input, LinkButton, SimpleTable, currentPeriod, td, useMoney } from '@/components/people/ui';
import { useEmployeesLookup, useLabelMap, usePeopleMutation, usePeopleQuery } from '@/hooks/use-people';
import { hrService, type EosProvision } from '@/services/people-hr.service';
import AccountPicker from '@/components/finance/AccountPicker';
import { Button, Card } from '@/components/people/ui';

function previousPeriod() {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 7);
}

/** Monthly end-of-service (gratuity) provisions (مخصص مكافأة نهاية الخدمة). */
export default function EosProvisionsPage() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const money = useMoney();
  const { data = [], isLoading } = usePeopleQuery(['hr-eos-provisions'], hrService.provisions);
  const { data: employees } = useEmployeesLookup();
  const empMap = useLabelMap(employees);
  const [runOpen, setRunOpen] = useState(false);
  const [run, setRun] = useState({ period: previousPeriod(), postingDate: '' });
  const [viewId, setViewId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<EosProvision | null>(null);
  const [reverseDate, setReverseDate] = useState('');
  const { data: detail } = usePeopleQuery(['hr-eos-provisions', viewId], () => hrService.provision(viewId!), !!viewId);

  const create = usePeopleMutation(() => hrService.createProvision({ period: run.period, postingDate: run.postingDate || undefined }), {
    invalidate: ['hr-eos-provisions'],
    success: t('provisionPosted'),
    onSuccess: (p) => {
      setRunOpen(false);
      setViewId(p.id);
    },
  });
  const reverse = usePeopleMutation(() => hrService.reverseProvision(reversing!.id, reverseDate || undefined), {
    invalidate: ['hr-eos-provisions'],
    success: t('provisionReversed'),
    onSuccess: () => setReversing(null),
  });

  // GL accounts of the provision (HR settings)
  const { data: settings } = usePeopleQuery(['hr-settings'], hrService.settings);
  const [accounts, setAccounts] = useState<{ eosExpenseAccountId: string; eosProvisionAccountId: string; martyrsFundAccountId: string } | null>(null);
  const acc = accounts ?? {
    eosExpenseAccountId: settings?.accounts?.eosExpenseAccountId ?? '',
    eosProvisionAccountId: settings?.accounts?.eosProvisionAccountId ?? '',
    martyrsFundAccountId: settings?.accounts?.martyrsFundAccountId ?? '',
  };
  const accountsMissing = !!settings && (!settings.accounts?.eosExpenseAccountId || !settings.accounts?.eosProvisionAccountId);
  const saveAccounts = usePeopleMutation(
    () =>
      hrService.updateAccounts({
        eosExpenseAccountId: acc.eosExpenseAccountId || null,
        eosProvisionAccountId: acc.eosProvisionAccountId || null,
        martyrsFundAccountId: acc.martyrsFundAccountId || null,
      }),
    { invalidate: ['hr-settings'], onSuccess: () => setAccounts(null) },
  );

  // Only the latest posted provision can be reversed.
  const latestPosted = data.filter((p) => p.status === 'posted').sort((a, b) => b.period.localeCompare(a.period))[0];

  return (
    <div>
      <PageHeader title={t('eosProvisions')} action={{ label: t('runProvision'), onClick: () => setRunOpen(true) }} />
      <p className="text-sm text-gray-500 -mt-4 mb-4">{t('eosIntro')}</p>
      <Card title={t('eosAccounts')} className="mb-4">
        {accountsMissing && <p className="text-sm text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">{t('eosAccountsMissing')}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <Field label={t('eosExpenseAccount')}>
            <AccountPicker value={acc.eosExpenseAccountId} onChange={(id) => setAccounts({ ...acc, eosExpenseAccountId: id })} />
          </Field>
          <Field label={t('eosProvisionAccount')}>
            <AccountPicker value={acc.eosProvisionAccountId} onChange={(id) => setAccounts({ ...acc, eosProvisionAccountId: id })} />
          </Field>
          <Field label={t('martyrsFundAccount')} hint={t('martyrsFundHint')}>
            <AccountPicker value={acc.martyrsFundAccountId} onChange={(id) => setAccounts({ ...acc, martyrsFundAccountId: id })} />
          </Field>
        </div>
        <div className="flex justify-end mt-3">
          <Button disabled={!accounts || saveAccounts.isPending} onClick={() => saveAccounts.mutate(undefined)}>
            {tc('save')}
          </Button>
        </div>
      </Card>
      <DataTable<EosProvision>
        data={data}
        loading={isLoading}
        onRowClick={(p) => setViewId(p.id)}
        columns={[
          { key: 'period', header: t('period') },
          { key: 'postingDate', header: t('postingDate') },
          { key: 'employeeCount', header: t('employeeCount') },
          { key: 'totalLiability', header: t('totalLiability'), render: (p) => money(p.totalLiability) },
          { key: 'totalDelta', header: t('provisionDelta'), render: (p) => money(p.totalDelta) },
          { key: 'status', header: tc('status'), render: (p) => <StatusBadge status={p.status === 'posted' ? 'posted' : 'cancelled'} label={t(`eos_${p.status}`)} /> },
        ]}
        actions={(p) =>
          p.id === latestPosted?.id ? (
            <LinkButton className="text-red-600" onClick={() => { setReverseDate(''); setReversing(p); }}>
              {t('reverse')}
            </LinkButton>
          ) : null
        }
      />

      <Modal isOpen={runOpen} onClose={() => setRunOpen(false)} title={t('runProvision')} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }} className="space-y-4">
          <Field label={t('period')} required>
            <Input type="month" required max={currentPeriod()} value={run.period} onChange={(e) => setRun((r) => ({ ...r, period: e.target.value }))} />
          </Field>
          <Field label={t('postingDate')} hint={t('provisionPostingHint')}>
            <Input type="date" value={run.postingDate} onChange={(e) => setRun((r) => ({ ...r, postingDate: e.target.value }))} />
          </Field>
          <FormActions onCancel={() => setRunOpen(false)} submitting={create.isPending} submitLabel={t('runProvision')} />
        </form>
      </Modal>

      <Modal isOpen={!!reversing} onClose={() => setReversing(null)} title={`${t('reverse')}: ${reversing?.period ?? ''}`} size="sm">
        <form onSubmit={(e) => { e.preventDefault(); reverse.mutate(undefined); }} className="space-y-4">
          <Field label={t('reversalDate')} hint={t('reversalDateHint')}>
            <Input type="date" value={reverseDate} onChange={(e) => setReverseDate(e.target.value)} />
          </Field>
          <FormActions onCancel={() => setReversing(null)} submitting={reverse.isPending} submitLabel={t('reverse')} />
        </form>
      </Modal>

      <Modal isOpen={!!viewId} onClose={() => setViewId(null)} title={detail ? `${t('eosProvision')} ${detail.period}` : tc('loading')} size="xl">
        {detail && (
          <SimpleTable
            headers={[t('employee'), t('serviceYears'), t('monthlyWage'), t('liability'), t('booked'), t('provisionDelta')]}
            footer={
              <tr>
                <td className={td} colSpan={3}>
                  {tc('total')}
                </td>
                <td className={td}>{money(detail.totalLiability)}</td>
                <td className={td} />
                <td className={td}>{money(detail.totalDelta)}</td>
              </tr>
            }
          >
            {(detail.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td className={td}>{empMap.get(l.employeeId) ?? l.employeeCode}</td>
                <td className={td}>{Number(l.serviceYears).toFixed(2)}</td>
                <td className={td}>{money(l.monthlyWage)}</td>
                <td className={td}>{money(l.liability)}</td>
                <td className={td}>{money(l.booked)}</td>
                <td className={td}>{money(l.delta)}</td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Modal>
    </div>
  );
}
