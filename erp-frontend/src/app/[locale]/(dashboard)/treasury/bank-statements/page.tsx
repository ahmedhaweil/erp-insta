'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { Btn, Field, Money, Toolbar, inputCls, useLocalName } from '@/components/finance/ui';
import { useRouter } from '@/i18n/navigation';
import { byId, useFinAction, useTreasuries } from '@/hooks/use-finance';
import { treasuryService, type BankStatement } from '@/services/finance-treasury.service';

const SAMPLE = 'date,description,reference,amount\n2026-01-05,Customer transfer,TRX-1001,1500.00\n2026-01-06,Bank fees,FEE-01,-25.00';

export default function BankStatementsPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const name = useLocalName();
  const router = useRouter();
  const { data: treasuries = [] } = useTreasuries(false);
  const banks = treasuries.filter((tr) => tr.type === 'bank');
  const treasuriesById = byId(treasuries);
  const [treasuryId, setTreasuryId] = useState('');
  const { data: statements = [], isLoading } = useQuery({
    queryKey: ['bank-statements', treasuryId],
    queryFn: () => treasuryService.getStatements(treasuryId || undefined),
  });

  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ treasuryId: '', reference: '', openingBalance: '', closingBalance: '', csv: '' });

  const importStatement = useFinAction(
    () =>
      treasuryService.importStatement({
        treasuryId: form.treasuryId,
        reference: form.reference || undefined,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
        closingBalance: form.closingBalance ? Number(form.closingBalance) : undefined,
        csv: form.csv,
      }),
    {
      invalidate: ['bank-statements'],
      success: t('statementImported'),
      onSuccess: (s) => {
        setShowImport(false);
        router.push(`/treasury/bank-statements/${s.id}`);
      },
    },
  );

  const onFile = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, csv: String(reader.result ?? '') }));
    reader.readAsText(file);
  };

  const columns = [
    { key: 'reference', header: t('reference') },
    { key: 'treasuryId', header: t('bank'), render: (s: BankStatement) => name(treasuriesById[s.treasuryId]) },
    { key: 'startDate', header: t('from') },
    { key: 'endDate', header: t('to') },
    { key: 'openingBalance', header: t('openingBalance'), render: (s: BankStatement) => <Money value={s.openingBalance} /> },
    { key: 'closingBalance', header: t('closingBalance'), render: (s: BankStatement) => <Money value={s.closingBalance} /> },
    {
      key: 'status',
      header: tc('status'),
      render: (s: BankStatement) => <StatusBadge status={s.status === 'reconciled' ? 'completed' : 'open'} label={t(`stmt_${s.status}`)} />,
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('bankStatementsTitle')}</h1>
        <Btn
          onClick={() => {
            setForm({ treasuryId: banks[0]?.id ?? '', reference: '', openingBalance: '', closingBalance: '', csv: '' });
            setShowImport(true);
          }}
        >
          {t('importStatement')}
        </Btn>
      </div>
      <Toolbar>
        <Field label={t('bank')} className="w-60">
          <select className={inputCls} value={treasuryId} onChange={(e) => setTreasuryId(e.target.value)}>
            <option value="">{tc('all')}</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code} - {name(b)}
              </option>
            ))}
          </select>
        </Field>
      </Toolbar>
      <DataTable
        columns={columns}
        data={statements}
        loading={isLoading}
        searchable
        onRowClick={(s) => router.push(`/treasury/bank-statements/${s.id}`)}
      />

      <Modal isOpen={showImport} onClose={() => setShowImport(false)} title={t('importStatement')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label={t('bank') + ' *'}>
              <select className={inputCls} value={form.treasuryId} onChange={(e) => setForm({ ...form, treasuryId: e.target.value })}>
                <option value="">-</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} - {name(b)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('reference')}>
              <input className={inputCls} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </Field>
            <Field label={t('openingBalance')}>
              <input type="number" step="any" className={inputCls} value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
            </Field>
            <Field label={t('closingBalance')} hint={t('closingBalanceHint')}>
              <input type="number" step="any" className={inputCls} value={form.closingBalance} onChange={(e) => setForm({ ...form, closingBalance: e.target.value })} />
            </Field>
          </div>
          <Field label={t('csvFile')}>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          </Field>
          <Field label={t('csvPaste')} hint={t('csvHint')}>
            <textarea
              className={`${inputCls} font-mono text-xs`}
              dir="ltr"
              rows={10}
              placeholder={SAMPLE}
              value={form.csv}
              onChange={(e) => setForm({ ...form, csv: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={() => setShowImport(false)}>
              {tc('cancel')}
            </Btn>
            <Btn disabled={!form.treasuryId || !form.csv.trim() || importStatement.isPending} onClick={() => importStatement.mutate(undefined)}>
              {importStatement.isPending ? tc('loading') : t('import')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
