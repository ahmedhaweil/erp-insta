'use client';

import { useTranslations } from 'next-intl';
import { FileBarChart } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { REPORTS, REPORT_GROUPS } from '@/components/finance/reports/registry';

export default function ReportCenterPage() {
  const t = useTranslations('reports');
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('centerTitle')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('centerIntro')}</p>
      </div>
      {REPORT_GROUPS.map((g) => (
        <section key={g}>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">{t(`groups.${g}`)}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {REPORTS.filter((r) => r.group === g).map((r) => (
              <Link
                key={r.key}
                href={`/reports/${r.key}`}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:border-primary-400 hover:shadow-sm transition flex gap-3"
              >
                <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                  <FileBarChart size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{t(`names.${r.key}`)}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">{t(`descs.${r.key}`)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
