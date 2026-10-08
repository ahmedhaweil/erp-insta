'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, TrendingDown, ShoppingCart, AlertTriangle, Wallet, Landmark, BookOpen } from 'lucide-react';
import { useRouter, Link } from '@/i18n/navigation';
import StatCard from '@/components/ui/StatCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { Money, fmtMoney } from '@/components/finance/ui';
import { useFinAccounts } from '@/hooks/use-finance';
import { finReportsService, type AgingBuckets } from '@/services/finance-reports.service';

const BUCKETS: (keyof AgingBuckets)[] = ['current', '1-30', '31-60', '61-90', '90+'];
const BUCKET_COLORS = ['bg-green-500', 'bg-yellow-400', 'bg-orange-400', 'bg-orange-600', 'bg-red-600'];

function AgingCard({
  title,
  data,
  href,
}: {
  title: string;
  data?: { total: number; overdue: number; buckets: AgingBuckets };
  href: string;
}) {
  const t = useTranslations('finDash');
  const total = data?.total ?? 0;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <Link href={href} className="text-xs text-primary-600 hover:underline">
          {t('details')}
        </Link>
      </div>
      <div className="flex items-end justify-between mb-3">
        <div>
          <p className="text-xs text-gray-500">{t('total')}</p>
          <p className="text-2xl font-bold">
            <Money value={total} />
          </p>
        </div>
        <div className="text-end">
          <p className="text-xs text-gray-500">{t('overdue')}</p>
          <p className="text-lg font-semibold text-red-600">
            <Money value={data?.overdue ?? 0} />
          </p>
        </div>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3">
        {total > 0 &&
          BUCKETS.map((b, i) => {
            const v = data?.buckets?.[b] ?? 0;
            return v > 0 ? <div key={b} className={BUCKET_COLORS[i]} style={{ width: `${(v / total) * 100}%` }} title={`${t(`bucket.${b}`)}: ${fmtMoney(v)}`} /> : null;
          })}
      </div>
      <dl className="grid grid-cols-5 gap-1 text-xs">
        {BUCKETS.map((b, i) => (
          <div key={b}>
            <dt className="flex items-center gap-1 text-gray-500">
              <span className={`w-2 h-2 rounded-full ${BUCKET_COLORS[i]}`} />
              {t(`bucket.${b}`)}
            </dt>
            <dd className="font-medium tabular-nums" dir="ltr">
              {fmtMoney(data?.buckets?.[b] ?? 0)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function BalanceCard({
  title,
  icon,
  data,
}: {
  title: string;
  icon: React.ReactNode;
  data?: { balance: number; accounts: { accountId: string; code: string; name: string; balance: number }[] };
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {icon}
      </div>
      <p className="text-2xl font-bold mb-3">
        <Money value={data?.balance ?? 0} />
      </p>
      <ul className="space-y-1 text-sm">
        {(data?.accounts ?? []).map((a) => (
          <li key={a.accountId} className="flex justify-between">
            <span className="text-gray-600 truncate">
              {a.code} {a.name}
            </span>
            <Money value={a.balance} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const td = useTranslations('finDash');
  const tc = useTranslations('common');
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['fin-dashboard'],
    queryFn: finReportsService.getDashboard,
    refetchInterval: 60_000,
  });
  const { data: accounts, isLoading: loadingAccounts } = useFinAccounts();

  const val = (v?: number) => (isLoading ? '...' : fmtMoney(v ?? 0));
  const lowStock = data?.lowStockProducts ?? 0;
  const needsSetup = !loadingAccounts && accounts && accounts.length === 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      {needsSetup && (
        <div className="mb-6 bg-primary-50 border border-primary-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="text-primary-600 shrink-0" />
            <div>
              <p className="font-semibold text-primary-900">{td('setupTitle')}</p>
              <p className="text-sm text-primary-800">{td('setupText')}</p>
            </div>
          </div>
          <button
            onClick={() => router.push('/accounting/setup')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
          >
            {td('setupButton')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title={t('totalRevenue')} value={val(data?.totalRevenue)} icon={<DollarSign size={24} />} color="green" />
        <StatCard title={t('totalExpenses')} value={val(data?.totalExpenses)} icon={<TrendingDown size={24} />} color="red" />
        <StatCard title={t('netProfit')} value={val(data?.netProfit)} icon={<TrendingUp size={24} />} color="primary" />
        <StatCard
          title={t('pendingOrders')}
          value={isLoading ? '...' : String(data?.pendingOrders ?? 0)}
          icon={<ShoppingCart size={24} />}
          color="yellow"
        />
      </div>

      {lowStock > 0 && (
        <Link
          href="/inventory/stock"
          className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3 hover:bg-amber-100 transition"
        >
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <span className="text-sm text-amber-800">{td('lowStock', { count: lowStock })}</span>
        </Link>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <AgingCard title={td('receivables')} data={data?.receivables} href="/reports/aged-receivables" />
        <AgingCard title={td('payables')} data={data?.payables} href="/reports/aged-payables" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <BalanceCard title={td('cash')} icon={<Wallet className="text-green-600" />} data={data?.cash} />
        <BalanceCard title={td('bank')} icon={<Landmark className="text-primary-600" />} data={data?.bank} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">{td('topProducts')}</h2>
            <Link href="/reports/sales-analysis" className="text-xs text-primary-600 hover:underline">
              {td('details')}
            </Link>
          </div>
          {data?.topProducts?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-100">
                  <th className="text-start py-1.5">{td('product')}</th>
                  <th className="text-end py-1.5">{tc('quantity')}</th>
                  <th className="text-end py-1.5">{td('net')}</th>
                  <th className="text-end py-1.5">{td('grossProfit')}</th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((p) => (
                  <tr key={p.productId} className="border-b border-gray-50 last:border-0">
                    <td className="py-1.5">
                      <span className="text-gray-500">{p.code}</span> {p.name}
                    </td>
                    <td className="py-1.5 text-end tabular-nums">{p.quantity}</td>
                    <td className="py-1.5 text-end">
                      <Money value={p.net} />
                    </td>
                    <td className="py-1.5 text-end">
                      <Money value={p.grossProfit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-500">{td('noSalesThisMonth')}</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-3">{t('recentActivity')}</h2>
          {data?.recentOrders?.length ? (
            <div className="space-y-2">
              {data.recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition"
                  onClick={() => router.push('/sales/orders')}
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{order.orderNumber}</p>
                    <p className="text-xs text-gray-500">{order.customerName}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-medium">
                      <Money value={order.totalAmount} />
                    </p>
                    <StatusBadge status={order.status} label={tc.has(order.status as any) ? tc(order.status as any) : order.status} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">{t('welcome')}</p>
          )}
          <h3 className="font-semibold text-gray-900 mt-5 mb-2">{t('quickActions')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['/treasury/payments', td('qaPayments')],
              ['/treasury/vouchers', td('qaVouchers')],
              ['/accounting/journal-entries', td('qaJournal')],
              ['/reports', td('qaReports')],
            ].map(([href, label]) => (
              <button
                key={href}
                onClick={() => router.push(href)}
                className="p-3 text-sm bg-gray-50 hover:bg-primary-50 hover:text-primary-600 rounded-lg transition text-start"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
