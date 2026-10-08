'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { CheckCircle2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { useRouter } from '@/i18n/navigation';
import { Btn, Card, Field, Spinner, inputCls, useLocalName } from '@/components/finance/ui';
import { useFinAccounts, useFinAction } from '@/hooks/use-finance';
import { finAccountingService, type TemplateAccount } from '@/services/finance-accounting.service';

export default function AccountingSetupPage() {
  const t = useTranslations('acct');
  const tc = useTranslations('common');
  const name = useLocalName();
  const router = useRouter();
  const { data: accounts = [], isLoading: loadingAccounts } = useFinAccounts();
  const { data: templates = [], isLoading } = useQuery({ queryKey: ['chart-templates'], queryFn: finAccountingService.getTemplates });

  const [template, setTemplate] = useState<'eg' | 'sa'>('eg');
  const [fiscalYearStart, setFiscalYearStart] = useState(`${new Date().getFullYear()}-01-01`);
  const [baseCurrency, setBaseCurrency] = useState('');
  const [filter, setFilter] = useState('');

  const { data: preview = [], isFetching } = useQuery({
    queryKey: ['chart-template', template],
    queryFn: () => finAccountingService.previewTemplate(template),
  });

  const selected = templates.find((x) => x.code === template);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return preview;
    return preview.filter(
      (a) => a.code.startsWith(q) || a.nameAr.toLowerCase().includes(q) || a.nameEn.toLowerCase().includes(q),
    );
  }, [preview, filter]);

  const setup = useFinAction(finAccountingService.setup, {
    invalidate: ['fin-accounts', 'accounts', 'fiscal-years', 'accounting-settings', 'dashboard', 'fin-dashboard', 'tenant-current'],
    success: t('setupDone'),
    onSuccess: () => router.push('/accounting/settings'),
  });

  if (isLoading || loadingAccounts) return <Spinner />;

  const alreadySetUp = accounts.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t('setupTitle')} />

      {alreadySetUp ? (
        <Card>
          <div className="flex items-center gap-3 text-green-700">
            <CheckCircle2 />
            <div>
              <p className="font-medium">{t('alreadySetUp', { count: accounts.length })}</p>
              <p className="text-sm text-gray-600">{t('alreadySetUpHint')}</p>
            </div>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-gray-600">{t('setupIntro')}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {templates.map((tpl) => (
          <button
            key={tpl.code}
            type="button"
            onClick={() => setTemplate(tpl.code)}
            className={clsx(
              'text-start bg-white rounded-xl border-2 p-5 transition',
              template === tpl.code ? 'border-primary-500 ring-2 ring-primary-100' : 'border-gray-200 hover:border-gray-300',
            )}
          >
            <div className="font-semibold text-gray-900">{name(tpl)}</div>
            <div className="text-sm text-gray-500 mt-1">
              {t('templateStats', { accounts: tpl.accounts, postable: tpl.postableAccounts, currency: tpl.baseCurrency })}
            </div>
          </button>
        ))}
      </div>

      {!alreadySetUp && (
        <Card title={t('setupOptions')}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <Field label={t('fiscalYearStart')}>
              <input type="date" className={inputCls} value={fiscalYearStart} onChange={(e) => setFiscalYearStart(e.target.value)} />
            </Field>
            <Field label={t('baseCurrency')} hint={t('baseCurrencyHint', { currency: selected?.baseCurrency ?? '' })}>
              <input
                className={inputCls}
                dir="ltr"
                maxLength={3}
                placeholder={selected?.baseCurrency}
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
              />
            </Field>
            <Btn
              disabled={setup.isPending || !fiscalYearStart || (baseCurrency !== '' && baseCurrency.length !== 3)}
              onClick={() => setup.mutate({ template, fiscalYearStart, baseCurrency: baseCurrency || undefined })}
            >
              {setup.isPending ? tc('loading') : t('runSetup')}
            </Btn>
          </div>
        </Card>
      )}

      <Card
        title={t('previewTree')}
        actions={<input className={`${inputCls} w-56`} placeholder={tc('search')} value={filter} onChange={(e) => setFilter(e.target.value)} />}
      >
        {isFetching ? (
          <Spinner />
        ) : (
          <div className="max-h-[32rem] overflow-y-auto text-sm">
            {visible.map((a: TemplateAccount) => (
              <div
                key={a.code}
                className={clsx('flex items-center gap-2 py-1 border-b border-gray-50', !a.allowPosting && 'font-semibold')}
                style={{ paddingInlineStart: `${a.level * 1.25}rem` }}
              >
                <span className="tabular-nums text-gray-500 w-20 shrink-0">{a.code}</span>
                <span>{name(a)}</span>
                <span className="text-xs text-gray-400">({t(`type_${a.type}`)})</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
