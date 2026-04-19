'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { posService } from '@/services/pos.service';
import { useProducts } from '@/hooks/use-products';
import { toast } from 'sonner';
import { Monitor, ShoppingCart, DollarSign, Banknote } from 'lucide-react';
import type { PosSession, PosOrder } from '@/types';

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const locale = useLocale();

  const [session, setSession] = useState<PosSession | null>(null);
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [terminalId, setTerminalId] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');

  const [cartItems, setCartItems] = useState<{productId: string; name: string; price: number; quantity: number}[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'split'>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: products = [] } = useProducts();

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

        <div className="bg-white rounded-xl border border-gray-200 p-6 flex flex-col h-[600px]">
          <h2 className="text-lg font-semibold mb-3">{t('newSale')}</h2>

          {/* Product Search */}
          <input
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            placeholder={t('searchProducts')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3 focus:ring-2 focus:ring-primary-500"
          />

          {/* Product List (filtered) */}
          <div className="flex-1 overflow-y-auto mb-3 space-y-1">
            {products
              .filter(p => p.isActive && (
                p.nameAr.includes(productSearch) ||
                (p.nameEn || '').toLowerCase().includes(productSearch.toLowerCase()) ||
                p.code.toLowerCase().includes(productSearch.toLowerCase())
              ))
              .slice(0, 20)
              .map(p => (
                <button
                  key={p.id}
                  onClick={() => {
                    const existing = cartItems.find(c => c.productId === p.id);
                    if (existing) {
                      setCartItems(cartItems.map(c => c.productId === p.id ? {...c, quantity: c.quantity + 1} : c));
                    } else {
                      setCartItems([...cartItems, { productId: p.id, name: locale === 'ar' ? p.nameAr : (p.nameEn || p.nameAr), price: Number(p.sellPrice), quantity: 1 }]);
                    }
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-primary-50 rounded-lg text-sm text-start"
                >
                  <span>{locale === 'ar' ? p.nameAr : (p.nameEn || p.nameAr)}</span>
                  <span className="font-medium text-primary-600">{Number(p.sellPrice).toFixed(2)}</span>
                </button>
              ))
            }
          </div>

          {/* Cart Items */}
          {cartItems.length > 0 && (
            <div className="border-t pt-3 mb-3 max-h-48 overflow-y-auto space-y-2">
              {cartItems.map(item => (
                <div key={item.productId} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{item.name}</span>
                  <button onClick={() => setCartItems(cartItems.map(c => c.productId === item.productId ? {...c, quantity: Math.max(1, c.quantity - 1)} : c))} className="w-6 h-6 bg-gray-200 rounded text-center hover:bg-gray-300">-</button>
                  <span className="w-8 text-center">{item.quantity}</span>
                  <button onClick={() => setCartItems(cartItems.map(c => c.productId === item.productId ? {...c, quantity: c.quantity + 1} : c))} className="w-6 h-6 bg-gray-200 rounded text-center hover:bg-gray-300">+</button>
                  <span className="w-20 text-end">{(item.price * item.quantity).toFixed(2)}</span>
                  <button onClick={() => setCartItems(cartItems.filter(c => c.productId !== item.productId))} className="text-red-500 hover:text-red-700">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          {cartItems.length > 0 && (
            <>
              {(() => {
                const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
                const tax = subtotal * 0.15;
                const total = subtotal + tax;
                return (
                  <div className="border-t pt-3 space-y-1 text-sm mb-3">
                    <div className="flex justify-between"><span className="text-gray-600">{tc('subtotal')}</span><span>{subtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">{tc('tax')} 15%</span><span>{tax.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold text-base"><span>{tc('total')}</span><span>{total.toFixed(2)}</span></div>
                  </div>
                );
              })()}

              {/* Payment Method */}
              <div className="flex gap-2 mb-3">
                {(['cash', 'card', 'split'] as const).map(m => (
                  <button key={m} onClick={() => setPaymentMethod(m)} className={`flex-1 py-1.5 text-xs rounded-lg border ${paymentMethod === m ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-300'}`}>
                    {t(m)}
                  </button>
                ))}
              </div>

              {paymentMethod === 'cash' && (
                <input
                  type="number" step="0.01"
                  value={cashReceived}
                  onChange={e => setCashReceived(e.target.value)}
                  placeholder={t('cashReceived')}
                  dir="ltr"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2"
                />
              )}

              <button
                disabled={isSubmitting || cartItems.length === 0}
                onClick={async () => {
                  setIsSubmitting(true);
                  try {
                    const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
                    const taxAmount = subtotal * 0.15;
                    const totalAmount = subtotal + taxAmount;
                    const newOrder = await posService.createOrder({
                      sessionId: session!.id,
                      paymentMethod,
                      cashReceived: paymentMethod === 'cash' ? Number(cashReceived) : undefined,
                      lines: cartItems.map(item => ({
                        productId: item.productId,
                        quantity: item.quantity,
                        unitPrice: item.price,
                        taxRate: 15,
                      })),
                    });
                    setOrders(prev => [...prev, newOrder]);
                    setCartItems([]);
                    setCashReceived('');
                    setProductSearch('');
                    toast.success(t('completeSale'));
                  } catch (err: any) {
                    toast.error(err.response?.data?.message || 'Failed to complete sale');
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                className="w-full py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {isSubmitting ? tc('loading') : t('completeSale')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
