'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Play } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import AccountPicker from '@/components/finance/AccountPicker';
import { ExcelButton, PdfButton, ReportTable } from '@/components/finance/ReportTable';
import { findReport, type FilterKey } from '@/components/finance/reports/registry';
import { Btn, Field, Money, Spinner, apiError, firstOfYearIso, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { useBranches, useCostCenters, useCustomersLookup, useFiscalYears, useSuppliersLookup, useUsersLookup } from '@/hooks/use-finance';
import { finReportsService } from '@/services/finance-reports.service';
import api from '@/lib/api';
import { PrintButton } from '@/components/platform/PrintButton';

const SALES_GROUPS = ['product', 'customer', 'category', 'branch', 'salesperson', 'month', 'invoice', 'day'];
const PURCHASE_GROUPS = ['supplier', 'product', 'category', 'branch', 'month', 'invoice'];

function initialParams(filters: FilterKey[], defaults: Record<string, unknown> = {}) {
  const p: Record<string, any> = { ...defaults };
  if (filters.includes('from')) p.from = firstOfYearIso();
  if (filters.includes('to')) p.to = todayIso();
  if (filters.includes('asOf')) p.asOf = todayIso();
  return p;
}

export default function ReportPage() {
  const { report: key } = useParams<{ report: string }>();
  const def = findReport(key);
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const tPl = useTranslations('platform');
  const locale = useLocale();
  const name = useLocalName();
  const router = useRouter();

  const filters = def?.filters ?? [];
  const has = (f: FilterKey) => filters.includes(f);
  const [draft, setDraft] = useState<Record<string, any>>(() => initialParams(filters, def?.defaults));
  const [params, setParams] = useState<Record<string, any>>(draft);
  const set = (k: string, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  const { data: branches = [] } = useBranches();
  const { data: costCenters = [] } = useCostCenters();
  const { data: customers = [] } = useCustomersLookup();
  const { data: suppliers = [] } = useSuppliersLookup();
  const { data: years = [] } = useFiscalYears();
  const { data: users = [] } = useUsersLookup();
  const { data: products = [] } = useQuery({
    queryKey: ['fin-products'],
    queryFn: () => api.get('/inventory/products').then((r) => r.data.data as any[]),
    enabled: has('productId'),
    staleTime: 60_000,
  });

  const missing = (def?.required ?? []).some((f) => (f === 'partner' ? !params.partnerId : !params[f]));

  const query = useQuery({
    queryKey: ['report', key, params],
    queryFn: () => finReportsService.getReport(def!.endpoint, params),
    enabled: !!def && !missing,
    retry: false,
  });

  const result = useMemo(() => {
    if (!def || !query.data) return null;
    try {
      return def.render(query.data, { t: t as any, has: (k) => t.has(k as any), name, locale });
    } catch {
      return null;
    }
  }, [def, query.data, t, name, locale]);

  if (!def) {
    return <p className="text-gray-500">{t('notFound')}</p>;
  }

  const Back = locale === 'ar' ? ArrowRight : ArrowLeft;
  const run = () => setParams({ ...draft });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/reports')} className="p-2 rounded-lg hover:bg-gray-100" aria-label={tc('back')}>
            <Back size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t(`names.${def.key}`)}</h1>
            <p className="text-sm text-gray-500">{t(`descs.${def.key}`)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {def.key === 'partner-statement' && params.partnerId && (
            <PrintButton
              size="md"
              label={tPl('print.statement')}
              path={`/print/statements/${params.partnerType ?? 'customer'}/${params.partnerId}`}
              params={{ from: params.from, to: params.to }}
            />
          )}
          <PdfButton endpoint={def.endpoint} params={params} disabled={missing} />
          <ExcelButton endpoint={def.endpoint} params={params} disabled={missing} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-wrap items-end gap-3">
          {has('partner') && (
            <>
              <Field label={t('f.partnerType')} className="w-36">
                <select
                  className={inputCls}
                  value={draft.partnerType ?? 'customer'}
                  onChange={(e) => setDraft((d) => ({ ...d, partnerType: e.target.value, partnerId: '' }))}
                >
                  <option value="customer">{t('f.customer')}</option>
                  <option value="supplier">{t('f.supplier')}</option>
                </select>
              </Field>
              <Field label={t('f.partner') + ' *'} className="w-60">
                <select className={inputCls} value={draft.partnerId ?? ''} onChange={(e) => set('partnerId', e.target.value)}>
                  <option value="">-</option>
                  {((draft.partnerType ?? 'customer') === 'customer' ? customers : suppliers).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} - {name(p)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {has('accountId') && (
            <Field label={t('f.account') + ' *'} className="w-72">
              <AccountPicker value={draft.accountId} onChange={(id) => set('accountId', id)} postableOnly={false} />
            </Field>
          )}
          {has('fiscalYearId') && (
            <Field label={t('f.fiscalYear') + ' *'} className="w-48">
              <select className={inputCls} value={draft.fiscalYearId ?? ''} onChange={(e) => set('fiscalYearId', e.target.value)}>
                <option value="">-</option>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('from') && (
            <Field label={t('f.from')}>
              <input type="date" className={inputCls} value={draft.from ?? ''} onChange={(e) => set('from', e.target.value)} />
            </Field>
          )}
          {has('to') && (
            <Field label={t('f.to')}>
              <input type="date" className={inputCls} value={draft.to ?? ''} onChange={(e) => set('to', e.target.value)} />
            </Field>
          )}
          {has('asOf') && (
            <Field label={t('f.asOf')}>
              <input type="date" className={inputCls} value={draft.asOf ?? ''} onChange={(e) => set('asOf', e.target.value)} />
            </Field>
          )}
          {has('branchId') && (
            <Field label={t('f.branch')} className="w-44">
              <select className={inputCls} value={draft.branchId ?? ''} onChange={(e) => set('branchId', e.target.value)}>
                <option value="">{tc('all')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('costCenterId') && (
            <Field label={t('f.costCenter')} className="w-48">
              <select className={inputCls} value={draft.costCenterId ?? ''} onChange={(e) => set('costCenterId', e.target.value)}>
                <option value="">{tc('all')}</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {name(c)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(has('salesGroupBy') || has('purchaseGroupBy')) && (
            <Field label={t('f.groupBy')} className="w-40">
              <select className={inputCls} value={draft.groupBy ?? ''} onChange={(e) => set('groupBy', e.target.value)}>
                {(has('salesGroupBy') ? SALES_GROUPS : PURCHASE_GROUPS).map((g) => (
                  <option key={g} value={g}>
                    {t(`group.${g}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('source') && (
            <Field label={t('f.source')} className="w-36">
              <select className={inputCls} value={draft.source ?? 'all'} onChange={(e) => set('source', e.target.value)}>
                {['all', 'invoices', 'pos'].map((s) => (
                  <option key={s} value={s}>
                    {t(`source.${s}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('customerId') && (
            <Field label={t('f.customer')} className="w-52">
              <select className={inputCls} value={draft.customerId ?? ''} onChange={(e) => set('customerId', e.target.value)}>
                <option value="">{tc('all')}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {name(c)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('supplierId') && (
            <Field label={t('f.supplier')} className="w-52">
              <select className={inputCls} value={draft.supplierId ?? ''} onChange={(e) => set('supplierId', e.target.value)}>
                <option value="">{tc('all')}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {name(s)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('productId') && (
            <Field label={t('f.product')} className="w-52">
              <select className={inputCls} value={draft.productId ?? ''} onChange={(e) => set('productId', e.target.value)}>
                <option value="">{tc('all')}</option>
                {products.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {name(p)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('userId') && (
            <Field label={t('f.user')} className="w-44">
              <select className={inputCls} value={draft.userId ?? ''} onChange={(e) => set('userId', e.target.value)}>
                <option value="">{tc('all')}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {has('country') && (
            <Field label={t('f.country')} className="w-36">
              <select className={inputCls} value={draft.country ?? ''} onChange={(e) => set('country', e.target.value)}>
                <option value="">{t('f.tenantDefault')}</option>
                <option value="eg">{t('f.egypt')}</option>
                <option value="sa">{t('f.saudi')}</option>
              </select>
            </Field>
          )}
          {has('maxLevel') && draft.hierarchy && (
            <Field label={t('f.maxLevel')} className="w-28">
              <input type="number" min={0} max={10} className={inputCls} value={draft.maxLevel ?? ''} onChange={(e) => set('maxLevel', e.target.value)} />
            </Field>
          )}
          {has('limit') && (
            <Field label={t('f.limit')} className="w-24">
              <input type="number" min={1} className={inputCls} value={draft.limit ?? ''} onChange={(e) => set('limit', e.target.value)} />
            </Field>
          )}
          {(['hierarchy', 'includeZero', 'includeChildren'] as const)
            .filter((f) => has(f))
            .map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={!!draft[f]} onChange={(e) => set(f, e.target.checked)} />
                {t(`f.${f}`)}
              </label>
            ))}
          <Btn onClick={run}>
            <Play size={14} /> {t('run')}
          </Btn>
        </div>
      </div>

      {missing ? (
        <p className="text-sm text-gray-500">{t('fillRequired')}</p>
      ) : query.isLoading ? (
        <Spinner />
      ) : query.isError ? (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg p-3">{apiError(query.error, tc('error'))}</p>
      ) : result ? (
        <div className="space-y-4">
          {result.summary && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {result.summary.map((s, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className="text-lg font-semibold mt-1">{s.money ? <Money value={s.value} /> : String(s.value ?? '-')}</p>
                </div>
              ))}
            </div>
          )}
          {result.sections.map((s, i) => (
            <ReportTable key={i} section={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
