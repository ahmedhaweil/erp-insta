'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Modal from '@/components/ui/Modal';
import { Btn, Field, inputCls, useLocalName } from '@/components/finance/ui';
import { byId, useBranches, useCostCenters, useFinAction } from '@/hooks/use-finance';
import { finAccountingService, type CostCenter } from '@/services/finance-accounting.service';

const empty = { code: '', nameAr: '', nameEn: '', parentId: '', branchId: '' };

/** Cost centers (مراكز التكلفة): used on journal lines, budgets and the P&L by cost center. */
export default function CostCentersPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const name = useLocalName();
  const { data: centers = [], isLoading } = useCostCenters();
  const { data: branches = [] } = useBranches();
  const centersById = byId(centers);
  const branchesById = byId(branches);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [form, setForm] = useState(empty);

  const close = () => {
    setOpen(false);
    setEditing(null);
    setForm(empty);
  };

  const save = useFinAction(
    () => {
      if (editing) {
        const patch: Record<string, unknown> = {};
        if (form.code !== editing.code) patch.code = form.code;
        if (form.nameAr !== editing.nameAr) patch.nameAr = form.nameAr;
        if (form.nameEn !== (editing.nameEn ?? '')) patch.nameEn = form.nameEn || null;
        if (form.parentId !== (editing.parentId ?? '')) patch.parentId = form.parentId || null;
        if (form.branchId !== (editing.branchId ?? '')) patch.branchId = form.branchId || null;
        return finAccountingService.updateCostCenter(editing.id, patch as any);
      }
      return finAccountingService.createCostCenter({
        code: form.code,
        nameAr: form.nameAr,
        nameEn: form.nameEn || undefined,
        parentId: form.parentId || undefined,
        branchId: form.branchId || undefined,
      });
    },
    { invalidate: ['fin-cost-centers'], onSuccess: close },
  );

  const startEdit = (c: CostCenter) => {
    setEditing(c);
    setForm({ code: c.code, nameAr: c.nameAr, nameEn: c.nameEn ?? '', parentId: c.parentId ?? '', branchId: c.branchId ?? '' });
    setOpen(true);
  };

  // A center cannot become a child of itself or of one of its descendants.
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of centers) {
        if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
          out.add(c.id);
          grew = true;
        }
      }
    }
    return out;
  };
  const blocked = editing ? descendants(editing.id) : new Set<string>();

  const columns = [
    { key: 'code', header: tc('code') },
    { key: 'nameAr', header: tc('name'), render: (c: CostCenter) => name(c) },
    {
      key: 'parentId',
      header: t('parentCostCenter'),
      render: (c: CostCenter) => (c.parentId && centersById[c.parentId] ? `${centersById[c.parentId].code} - ${name(centersById[c.parentId])}` : ''),
    },
    { key: 'branchId', header: t('branch'), render: (c: CostCenter) => (c.branchId ? branchesById[c.branchId]?.name ?? '' : '') },
  ];

  return (
    <div>
      <PageHeader title={t('costCentersTitle')} action={{ label: t('newCostCenter'), onClick: () => setOpen(true) }} />
      <p className="text-sm text-gray-500 -mt-4 mb-4">{t('costCentersIntro')}</p>
      <DataTable
        columns={columns}
        data={centers}
        loading={isLoading}
        searchable
        pageSize={25}
        onRowClick={startEdit}
        actions={(c) => (
          <Btn size="sm" variant="ghost" onClick={() => startEdit(c)}>
            {tc('edit')}
          </Btn>
        )}
      />
      <Modal isOpen={open} onClose={close} title={editing ? t('editCostCenter') : t('newCostCenter')}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('code') + ' *'}>
              <input className={inputCls} dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('branch')}>
              <select className={inputCls} value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                <option value="">-</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('nameAr') + ' *'}>
              <input className={inputCls} value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
            </Field>
            <Field label={t('nameEn')}>
              <input className={inputCls} value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </Field>
          </div>
          <Field label={t('parentCostCenter')}>
            <select className={inputCls} value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">-</option>
              {centers
                .filter((c) => !blocked.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {name(c)}
                  </option>
                ))}
            </select>
          </Field>
          <div className="flex justify-end gap-3">
            <Btn variant="secondary" onClick={close}>
              {tc('cancel')}
            </Btn>
            <Btn disabled={!form.code || !form.nameAr || save.isPending} onClick={() => save.mutate(undefined)}>
              {tc('save')}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
}
