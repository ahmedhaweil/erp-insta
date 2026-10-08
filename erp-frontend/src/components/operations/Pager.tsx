'use client';

import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Server-side paging for endpoints taking limit / offset without a total
 * count: "next" is enabled while a full page came back.
 */
export default function Pager({
  offset,
  limit,
  count,
  onChange,
}: {
  offset: number;
  limit: number;
  count: number;
  onChange: (offset: number) => void;
}) {
  const t = useTranslations('ops');
  const page = Math.floor(offset / limit) + 1;
  return (
    <div className="flex items-center justify-between gap-3 mt-3 text-sm text-gray-600">
      <span>
        {t('paging.page', { page })} · {count ? t('paging.rows', { from: offset + 1, to: offset + count }) : t('common.noData')}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronRight size={14} className="ltr:hidden" />
          <ChevronLeft size={14} className="rtl:hidden" />
          {t('paging.previous')}
        </button>
        <button
          type="button"
          onClick={() => onChange(offset + limit)}
          disabled={count < limit}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
        >
          {t('paging.next')}
          <ChevronLeft size={14} className="ltr:hidden" />
          <ChevronRight size={14} className="rtl:hidden" />
        </button>
      </div>
    </div>
  );
}
