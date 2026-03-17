'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { posService } from '@/services/pos.service';
import { Monitor, ShoppingCart, DollarSign, CreditCard, Banknote } from 'lucide-react';
import type { PosSession, PosOrder } from '@/types';

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');

  const [session, setSession] = useState<PosSession | null>(null);
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');

  const handleOpenSession = async () => {
    try {
      const s = await posService.openSession({ terminalId, openingCash: Number(openingCash) });
      setSession(s);
    } catch { /* handle */ }
  };

  const handleCloseSession = async () => {
    if (!session) return;
    try {
      await posService.closeSession(session.id, { closingCash: Number(closingCash) });
      setSession(null);
      setOrders([]);
    } catch { /* handle */ }
  };

  if (!session) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Monitor size={32} className="text-primary-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-6">{t('openSession')}</h2>
          <div className="space-y-4 text-start">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('terminal')}</label>
              <input value={terminalId} onChange={(e) => setTerminalId(e.target.value)} placeholder="Terminal ID" dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('openingCash')}</label>
              <input type="number" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} dir="ltr" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <button onClick={handleOpenSession} className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
              {t('openSession')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const totalSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
        <button onClick={() => { setClosingCash(String(totalSales + Number(session.openingCash))); handleCloseSession(); }} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm">{t('closeSession')}</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-green-50 text-green-600 rounded-xl flex items-center justify-center"><DollarSign size={24} /></div>
          <div><p className="text-sm text-gray-500">{t('totalSales')}</p><p className="text-xl font-bold">{totalSales.toFixed(2)}</p></div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center"><ShoppingCart size={24} /></div>
          <div><p className="text-sm text-gray-500">{t('totalOrders')}</p><p className="text-xl font-bold">{orders.length}</p></div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-12 h-12 bg-yellow-50 text-yellow-600 rounded-xl flex items-center justify-center"><Banknote size={24} /></div>
          <div><p className="text-sm text-gray-500">{t('openingCash')}</p><p className="text-xl font-bold">{Number(session.openingCash).toFixed(2)}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">{t('todaySales')}</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">{tc('noData')}</p>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => (
                <div key={order.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <span className="font-medium">{order.orderNumber}</span>
                    <span className="text-sm text-gray-500 ms-3">{order.paymentMethod === 'cash' ? t('cash') : order.paymentMethod === 'card' ? t('card') : t('split')}</span>
                  </div>
                  <span className="font-semibold">{Number(order.totalAmount).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">{t('newSale')}</h2>
          <p className="text-sm text-gray-500">{t('sessionSummary')}</p>
        </div>
      </div>
    </div>
  );
}
