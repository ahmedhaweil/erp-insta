'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { notificationsService } from '@/services/notifications.service';
import { Bell, CheckCheck, Info, AlertTriangle, XCircle, CheckCircle } from 'lucide-react';
import { clsx } from 'clsx';
import type { Notification } from '@/types';

const typeIcons = {
  info: <Info size={18} className="text-blue-500" />,
  warning: <AlertTriangle size={18} className="text-yellow-500" />,
  error: <XCircle size={18} className="text-red-500" />,
  success: <CheckCircle size={18} className="text-green-500" />,
};

export default function NotificationsPage() {
  const t = useTranslations('notifications');
  const tc = useTranslations('common');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try { setNotifications(await notificationsService.getMyNotifications()); }
    catch { /* handle */ }
    finally { setLoading(false); }
  };

  const handleMarkRead = async (id: string) => {
    await notificationsService.markAsRead(id);
    loadData();
  };

  const handleMarkAllRead = async () => {
    await notificationsService.markAllRead();
    loadData();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <button onClick={handleMarkAllRead} className="flex items-center gap-1.5 px-4 py-2 text-sm text-primary-600 hover:bg-primary-50 rounded-lg transition">
          <CheckCheck size={16} />
          {t('markAllRead')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">{tc('loading')}</div>
      ) : notifications.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Bell size={48} className="text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">{t('noNotifications')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.isRead && handleMarkRead(n.id)}
              className={clsx(
                'bg-white rounded-xl border p-4 flex items-start gap-3 cursor-pointer transition',
                n.isRead ? 'border-gray-200' : 'border-primary-200 bg-primary-50/30',
              )}
            >
              <div className="mt-0.5">{typeIcons[n.type]}</div>
              <div className="flex-1">
                <p className={clsx('text-sm', n.isRead ? 'text-gray-700' : 'text-gray-900 font-medium')}>{n.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{n.body}</p>
                <p className="text-xs text-gray-400 mt-1">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              {!n.isRead && <div className="w-2 h-2 bg-primary-500 rounded-full mt-2" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
