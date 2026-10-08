'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { useLocale } from 'next-intl';
import { ReportTable } from '@/components/finance/ReportTable';
import { Btn, Card, Field, KeyValue, Money, Spinner, Toolbar, firstOfMonthIso, inputCls, todayIso, useLocalName } from '@/components/finance/ui';
import { useRouter } from '@/i18n/navigation';
import { treasuryService } from '@/services/finance-treasury.service';

export default function CashBookPage() {
  const t = useTranslations('treasury');
  const tc = useTranslations('common');
  const ta = useTranslations('acct');
  const locale = useLocale();
  const name = useLocalName();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState({ from: firstOfMonthIso(), to: todayIso() });
  const [applied, setApplied] = useState(range);

  const { data, isLoading } = useQuery({
    queryKey: ['cash-book', id, applied],
    queryFn: () => treasuryService.getMovements(id, applied.from, applied.to),
    enabled: !!id,
  });

  const Back = locale === 'ar' ? ArrowRight : ArrowLeft;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/treasury/treasuries')} className="p-2 rounded-lg hover:bg-gray-100" aria-label={tc('back')}>
          <Back size={18} />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">
          {t('cashBook')} {data ? `- ${data.treasury.code} ${name(data.treasury)}` : ''}
        </h1>
      </div>

      <Card>
        <Toolbar>
          <Field label={t('from')}>
            <input type="date" className={inputCls} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label={t('to')}>
            <input type="date" className={inputCls} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <Btn onClick={() => setApplied(range)}>{tc('filter')}</Btn>
        </Toolbar>
        {data && (
          <KeyValue
            items={[
              { label: t('openingBalance'), value: <Money value={data.openingBalance} /> },
              { label: t('totalIn'), value: <Money value={data.totalIn} className="text-green-700" /> },
              { label: t('totalOut'), value: <Money value={data.totalOut} className="text-red-700" /> },
              { label: t('closingBalance'), value: <Money value={data.closingBalance} /> },
            ]}
          />
        )}
      </Card>

      {isLoading || !data ? (
        <Spinner />
      ) : (
        <ReportTable
          section={{
            columns: [
              { key: 'date', label: tc('date'), type: 'date' },
              { key: 'refNumber', label: ta('refNumber') },
              { key: 'description', label: tc('description') },
              {
                key: 'sourceType',
                label: ta('source'),
                render: (m) => (m.sourceType ? (ta.has(`src.${m.sourceType}`) ? ta(`src.${m.sourceType}`) : m.sourceType) : ta('manual')),
              },
              { key: 'moneyIn', label: t('moneyIn'), type: 'money' },
              { key: 'moneyOut', label: t('moneyOut'), type: 'money' },
              { key: 'balance', label: t('balance'), type: 'money' },
              { key: 'reconciled', label: t('reconciled'), render: (m) => (m.reconciled ? '✓' : '') },
            ],
            rows: [
              { id: 'opening', description: t('openingBalance'), balance: data.openingBalance },
              ...data.movements.map((m) => ({ ...m, id: m.journalLineId })),
            ],
            totals: { moneyIn: data.totalIn, moneyOut: data.totalOut, balance: data.closingBalance },
          }}
        />
      )}
    </div>
  );
}
