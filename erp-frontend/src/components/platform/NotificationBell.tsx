'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { Link, useRouter } from '@/i18n/navigation';
import { myNotificationsService, type MyNotification } from '@/services/platform.service';

const dot: Record<string, string> = {
  info: 'bg-blue-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  success: 'bg-green-500',
};

/** Header bell: unread count (polled) and the latest notifications. */
export default function NotificationBell() {
  const t = useTranslations('platform');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: count = 0 } = useQuery({
    queryKey: ['my-notifications', 'unread-count'],
    queryFn: myNotificationsService.unreadCount,
    refetchInterval: 60_000,
    retry: false,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['my-notifications', 'list'],
    queryFn: myNotificationsService.list,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['my-notifications'] });

  const openItem = async (n: MyNotification) => {
    if (!n.isRead) {
      try {
        await myNotificationsService.markRead(n.id);
      } catch {
        /* ignore */
      }
      refresh();
    }
    const link = n.data?.link;
    setOpen(false);
    if (typeof link === 'string' && link.startsWith('/')) router.push(link);
  };

  const title = (n: MyNotification) => {
    const bi = n.data?.title;
    if (bi && typeof bi === 'object' && (bi.ar || bi.en)) return locale === 'ar' ? bi.ar || bi.en : bi.en || bi.ar;
    return n.title;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
        aria-label={t('bell.title')}
        title={t('bell.title')}
      >
        <Bell size={18} />
        {count > 0 && (
          <span
            data-testid="unread-count"
            className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center"
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-40 mt-2 end-0 w-80 max-w-[90vw] bg-white border border-gray-200 rounded-xl shadow-xl">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <span className="font-semibold text-sm">{t('bell.title')}</span>
            {count > 0 && (
              <button
                type="button"
                className="text-xs text-primary-600 hover:underline inline-flex items-center gap-1"
                onClick={async () => {
                  await myNotificationsService.markAllRead();
                  refresh();
                }}
              >
                <CheckCheck size={14} /> {t('bell.markAll')}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {isLoading ? (
              <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p>
            ) : items.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">{t('bell.empty')}</p>
            ) : (
              items.slice(0, 10).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={clsx('w-full text-start px-4 py-2.5 hover:bg-gray-50 flex gap-2', !n.isRead && 'bg-primary-50/40')}
                >
                  <span className={clsx('mt-1.5 w-2 h-2 rounded-full shrink-0', dot[n.type] ?? 'bg-gray-400')} />
                  <span className="min-w-0">
                    <span className={clsx('block text-sm truncate', !n.isRead && 'font-semibold')}>{title(n)}</span>
                    {n.body && <span className="block text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{n.body}</span>}
                    <span className="block text-[11px] text-gray-400 mt-0.5" dir="ltr">
                      {new Date(n.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="px-4 py-2 border-t border-gray-100 text-center">
            <Link href="/notifications" onClick={() => setOpen(false)} className="text-sm text-primary-600 hover:underline">
              {t('bell.viewAll')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
