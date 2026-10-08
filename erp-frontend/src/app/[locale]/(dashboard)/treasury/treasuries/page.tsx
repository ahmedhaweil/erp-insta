'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Landmark, Wallet } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import AccountPicker, { useAccountLabel } from '@/components/finance/AccountPicker';
import { Btn, Field, Money, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { useRouter } from '@/i18n/navigation';
import { useBranches, useFinAction, useTreasuries, useUsersLookup } from '@/hooks/use-finance';
import { treasuryService, type Treasury } from '@/services/finance-treasury.service';

const emptyForm = {
  code: '',
  nameAr: '',
  nameEn: '',
  type: 'cash' as 'cash' | 'bank',
  accountId: '',
  branchId: '',
  bankName: '',
  bankBranch: '',
  accountNumber: '',
  iban: '',
  swiftCode: '',
  openingBalance: '',
  openingDate: todayIso(),
  custodianUserId: '',
  isActive: true,
  notes: '',
};

export default function TreasuriesPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const name = useLocalName();
  const router = useRouter();
  const accountLabel = useAccountLabel();
  const { data: treasuries = [], isLoading } = useTreasuries(true);
  const { data: branches = [] } = useBranches();
  const { data: users = [] } = useUsersLookup();

  const [editing, setEditing] = useState<Treasury | 'new' | null>(null);
  const [form, setForm] = useState(emptyForm);
  const set = <K extends keyof typeof emptyForm>(k: K, v: (typeof emptyForm)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const close = () => setEditing(null);
  const create = useFinAction(treasuryService.createTreasury, { invalidate: ['treasuries'], onSuccess: close });
  const update = useFinAction(({ id, data }: { id: string; data: Record<string, unknown> }) => treasuryService.updateTreasury(id, data), {
    invalidate: ['treasuries'],
    onSuccess: close,
  });

  const openNew = () => {
    setForm(emptyForm);
    setEditing('new');
  };
  const openEdit = (tr: Treasury) => {
    setForm({
      ...emptyForm,
      code: tr.code,
      nameAr: tr.nameAr,
      nameEn: tr.nameEn ?? '',
      type: tr.type,
      accountId: tr.accountId,
      branchId: tr.branchId ?? '',
      bankName: tr.bankName ?? '',
      bankBranch: tr.bankBranch ?? '',
      accountNumber: tr.accountNumber ?? '',
      iban: tr.iban ?? '',
      swiftCode: tr.swiftCode ?? '',
      isActive: tr.isActive,
      notes: tr.notes ?? '',
    });
    setEditing(tr);
  };

  const submit = () => {
    const opt = (v: string) => v || undefined;
    const common = {
      code: form.code,
      nameAr: form.nameAr,
      nameEn: opt(form.nameEn),
      type: form.type,
      branchId: opt(form.branchId),
      bankName: opt(form.bankName),
      bankBranch: opt(form.bankBranch),
      accountNumber: opt(form.accountNumber),
      iban: opt(form.iban),
      swiftCode: opt(form.swiftCode),
      custodianUserId: opt(form.custodianUserId),
      isActive: form.isActive,
      notes: opt(form.notes),
    };
    if (editing === 'new') {
      create.mutate({
        ...common,
        accountId: form.accountId,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
        openingDate: form.openingBalance ? form.openingDate : undefined,
      });
    } else if (editing) {
      update.mutate({ id: editing.id, data: common });
    }
  };

  const totals = treasuries.reduce(
    (acc, tr) => {
      acc[tr.type] += Number(tr.baseBalance ?? tr.balance ?? 0);
      return acc;
    },
    { cash: 0, bank: 0 },
  );

  const columns = [
    { key: 'code', header: tc('code') },
    { key: 'nameAr', header: tc('name'), render: (tr: Treasury) => name(tr) },
    { key: 'type', header: t('type'), render: (tr: Treasury) => t(`type_${tr.type}`) },
    { key: 'bankName', header: t('bankName'), render: (tr: Treasury) => tr.bankName ?? '' },
    { key: 'accountId', header: t('glAccount'), render: (tr: Treasury) => accountLabel(tr.accountId) },
    { key: 'balance', header: t('balance'), render: (tr: Treasury) => <Money value={tr.balance} className="font-semibold" /> },
    {
      key: 'isActive',
      header: tc('status'),
      render: (tr: Treasury) => <StatusBadge status={tr.isActive ? 'active' : 'inactive'} label={tr.isActive ? tc('active') : tc('inactive')} />,
    },
  ];

  const saving = create.isPending || update.isPending;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('treasuriesTitle')}</h1>
        <Btn onClick={openNew}>{t('newTreasury')}</Btn>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{t('totalCash')}</p>
            <p className="text-2xl font-bold mt-1">
              <Money value={totals.cash} />
            </p>
          </div>
          <Wallet className="text-green-600" />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">{t('totalBank')}</p>
            <p className="text-2xl font-bold mt-1">
              <Money value={totals.bank} />
            </p>
          </div>
          <Landmark className="text-primary-600" />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={treasuries}
        loading={isLoading}
        searchable
        onRowClick={(tr) => router.push(`/treasury/treasuries/${tr.id}`)}
        actions={(tr) => (
          <div className="flex gap-1">
            <Btn size="sm" variant="ghost" onClick={() => router.push(`/treasury/treasuries/${tr.id}`)}>
              {t('cashBook')}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => openEdit(tr)}>
              {tc('edit')}
            </Btn>
          </div>
        )}
      />

      <Modal isOpen={!!editing} onClose={close} title={editing === 'new' ? t('newTreasury') : t('editTreasury')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={tc('code') + ' *'}>
              <input className={inputCls} value={form.code} onChange={(e) => set('code', e.target.value)} />
            </Field>
            <Field label={t('nameAr') + ' *'}>
              <input className={inputCls} dir="rtl" value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
            </Field>
            <Field label={t('nameEn')}>
              <input className={inputCls} dir="ltr" value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
            </Field>
            <Field label={t('type')}>
              <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value as 'cash' | 'bank')}>
                <option value="cash">{t('type_cash')}</option>
                <option value="bank">{t('type_bank')}</option>
              </select>
            </Field>
            <Field label={t('glAccount') + ' *'} hint={editing !== 'new' ? t('accountLocked') : t('glAccountHint')}>
              <AccountPicker value={form.accountId} onChange={(id) => set('accountId', id)} types={['asset']} disabled={editing !== 'new'} />
            </Field>
            <Field label={t('branch')}>
              <select className={inputCls} value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                <option value="">-</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {form.type === 'bank' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={t('bankName')}>
                <input className={inputCls} value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
              </Field>
              <Field label={t('bankBranch')}>
                <input className={inputCls} value={form.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} />
              </Field>
              <Field label={t('accountNumber')}>
                <input className={inputCls} dir="ltr" value={form.accountNumber} onChange={(e) => set('accountNumber', e.target.value)} />
              </Field>
              <Field label="IBAN">
                <input className={inputCls} dir="ltr" value={form.iban} onChange={(e) => set('iban', e.target.value)} />
              </Field>
              <Field label="SWIFT">
                <input className={inputCls} dir="ltr" value={form.swiftCode} onChange={(e) => set('swiftCode', e.target.value)} />
              </Field>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {editing === 'new' && (
              <>
                <Field label={t('openingBalance')} hint={t('openingBalanceHint')}>
                  <input type="number" step="any" className={inputCls} value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} />
                </Field>
                <Field label={t('openingDate')}>
                  <input type="date" className={inputCls} value={form.openingDate} onChange={(e) => set('openingDate', e.target.value)} />
                </Field>
              </>
            )}
            <Field label={t('custodian')}>
              <select className={inputCls} value={form.custodianUserId} onChange={(e) => set('custodianUserId', e.target.value)}>
                <option value="">-</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={tc('notes')}>
            <textarea className={inputCls} rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            {tc('active')}
          </label>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={close}>
              {tc('cancel')}
            </Btn>
            <Btn onClick={submit} disabled={saving || !form.code || !form.nameAr || !form.accountId}>
              {saving ? tc('loading') : tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
