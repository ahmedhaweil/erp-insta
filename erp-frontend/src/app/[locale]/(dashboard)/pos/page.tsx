'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { Minus, Plus, ScanLine, Trash2, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { Btn, Field, inputCls, inputSm, SelectBox, toOptions } from '@/components/operations/form';
import { byId, Card, fmtDateTime, fmtMoney, num, useNamer } from '@/components/operations/common';
import { cartTotals, effectiveDiscountPct, lineAmounts, type CartLine } from '@/components/operations/pos/cart';
import { CashModal, CloseSessionModal, OrdersModal, PaymentModal, SessionReport, type PayMethod } from '@/components/operations/pos/PosModals';
import { isNetworkError, newClientReference, posStorage, type QueuedSale, type StoredSession } from '@/components/operations/pos/storage';
import { useOpsCategories, useOpsCustomers, useOpsMutation, useOpsQuery, useOpsTerminals } from '@/hooks/use-operations';
import { opsPos, type PosOrderInput } from '@/services/operations-pos.service';
import { opsInventory } from '@/services/operations-inventory.service';
import { apiError, type Row } from '@/services/operations-api';

/** Touch-friendly point of sale till with an offline sale queue. */
export default function PosPage() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setSession(posStorage.getSession());
    setReady(true);
  }, []);
  const update = (s: StoredSession | null) => {
    posStorage.setSession(s);
    setSession(s);
  };
  if (!ready) return null;
  return session ? <Till session={session} onEnd={() => update(null)} /> : <OpenSession onOpened={update} />;
}

function OpenSession({ onOpened }: { onOpened: (s: StoredSession) => void }) {
  const t = useTranslations('ops');
  const { data: terminals = [], isLoading } = useOpsTerminals();
  const active = terminals.filter((x) => x.isActive);
  const [terminalId, setTerminalId] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [resumeId, setResumeId] = useState('');
  const terminal = active.find((x) => x.id === terminalId);

  const open = useOpsMutation(() => opsPos.openSession({ terminalId, openingCash: num(openingCash) }), {
    success: 'sessionOpened',
    onSuccess: (s: Row) =>
      onOpened({ id: s.id, terminalId, terminalName: terminal?.name ?? '', openedAt: s.openedAt, openingCash: num(s.openingCash) }),
  });
  const resume = useOpsMutation(() => opsPos.summary(resumeId.trim()), {
    success: false,
    onSuccess: (sum: any) => {
      if (sum?.closingCash != null) {
        toast.error(t('pos.sessionAlreadyClosed'));
        return;
      }
      onOpened({ id: resumeId.trim(), terminalId, terminalName: terminal?.name ?? '', openedAt: new Date().toISOString(), openingCash: num(sum?.openingCash) });
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{t('pos.openSession')}</h1>
      <Card title={t('pos.pickTerminal')}>
        {isLoading ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-gray-500">{t('pos.noTerminals')}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {active.map((term) => (
              <button
                key={term.id}
                type="button"
                onClick={() => setTerminalId(term.id)}
                className={clsx(
                  'p-5 rounded-xl border-2 text-start transition',
                  terminalId === term.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:bg-gray-50',
                )}
              >
                <div className="text-lg font-semibold">{term.name}</div>
                {term.maxDiscountPercent != null && (
                  <div className="text-xs text-gray-500">{t('pos.maxDiscount')}: {num(term.maxDiscountPercent)}%</div>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('pos.openingCash')} className="flex-1">
            <input type="number" step="any" min="0" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} className={`${inputCls} text-xl py-3`} />
          </Field>
          <Btn size="lg" disabled={!terminalId} loading={open.isPending} onClick={() => open.mutate(undefined)}>
            {t('pos.openSession')}
          </Btn>
        </div>
      </Card>
      <Card title={t('pos.resumeSession')}>
        <p className="text-sm text-gray-600 mb-3">{t('pos.resumeHint')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('pos.sessionId')} className="flex-1">
            <input value={resumeId} onChange={(e) => setResumeId(e.target.value)} className={inputCls} />
          </Field>
          <Btn variant="secondary" disabled={!resumeId.trim()} loading={resume.isPending} onClick={() => resume.mutate(undefined)}>
            {t('pos.resume')}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

function Till({ session, onEnd }: { session: StoredSession; onEnd: () => void }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: terminals = [] } = useOpsTerminals();
  const terminal = terminals.find((x) => x.id === session.terminalId);
  const maxDiscount = terminal?.maxDiscountPercent != null ? num(terminal.maxDiscountPercent) : null;
  const products = useOpsQuery(['pos-products'], async () => {
    try {
      const list = await opsInventory.products();
      posStorage.setProducts(list);
      return list;
    } catch (err) {
      const cached = posStorage.getProducts();
      if (cached.length) return cached as Row[];
      throw err;
    }
  });
  const allProducts = useMemo(() => (products.data ?? []).filter((p) => p.isActive !== false), [products.data]);
  const productMap = useMemo(() => byId(allProducts), [allProducts]);
  const { data: categories = [] } = useOpsCategories();
  const { data: customers = [] } = useOpsCustomers();
  const summary = useOpsQuery(['pos-summary', session.id], () => opsPos.summary(session.id));

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<'pay' | 'orders' | 'cash' | 'close' | 'report' | 'queue' | null>(null);
  const [paying, setPaying] = useState(false);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [lastSale, setLastSale] = useState<{ number: string; total: number; change: number; offline?: boolean } | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const flushing = useRef(false);

  // ----- offline queue -----
  const saveQueue = (q: QueuedSale[]) => {
    posStorage.setQueue(q);
    setQueue(q);
  };
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      let q = posStorage.getQueue();
      for (const item of [...q]) {
        if (item.lastError) continue;
        try {
          await opsPos.createOrder(item.payload);
          q = q.filter((x) => x.clientReference !== item.clientReference);
        } catch (err) {
          if (isNetworkError(err)) break;
          q = q.map((x) => (x.clientReference === item.clientReference ? { ...x, attempts: x.attempts + 1, lastError: apiError(err, t('msg.error')) } : x));
        }
        posStorage.setQueue(q);
      }
      setQueue(q);
      summary.refetch();
    } finally {
      flushing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setQueue(posStorage.getQueue());
    setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = window.setInterval(() => {
      if (navigator.onLine && posStorage.getQueue().some((q) => !q.lastError)) flush();
    }, 30000);
    flush();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
    };
  }, [flush]);

  // ----- cart -----
  const addProduct = (p: Row, qty = 1, unitPrice?: number) => {
    const price = Math.round((unitPrice ?? num(p.sellPrice)) * 10000) / 10000;
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.productId === p.id && l.unitPrice === price);
      if (idx >= 0) return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + qty } : l));
      return [
        ...prev,
        { productId: p.id, name: name(p), code: p.code, quantity: qty, unitPrice: price, listPrice: num(p.sellPrice), discountPct: 0, taxRate: num(p.salesTaxRate) },
      ];
    });
    setSelected(p.id);
  };

  const scan = async (code: string) => {
    const value = code.trim();
    if (!value) return;
    const local = allProducts.find((p) => p.barcode === value || p.code === value);
    if (local) {
      addProduct(local);
    } else {
      try {
        const hit = await opsInventory.byBarcode(value);
        const factor = num(hit.factor) || 1;
        const product = productMap[hit.product.id] ?? hit.product;
        // An alternate unit (e.g. a box of 12) is sold as base units at the unit's price.
        addProduct(product, factor, factor !== 1 ? num(hit.price) / factor : num(hit.price) || undefined);
      } catch (err) {
        toast.error(isNetworkError(err) ? t('pos.barcodeOffline') : t('pos.barcodeNotFound'));
      }
    }
    setBarcode('');
    barcodeRef.current?.focus();
  };

  const updateLine = (i: number, patch: Partial<CartLine>) => setCart((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totals = cartTotals(cart);
  const overLimit = maxDiscount != null && cart.some((l) => effectiveDiscountPct(l) > maxDiscount + 0.0001);

  const visible = allProducts.filter((p) => {
    if (categoryId && p.categoryId !== categoryId) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [p.code, p.barcode, p.nameAr, p.nameEn].some((v) => v && String(v).toLowerCase().includes(q));
  });

  // ----- payment -----
  const pay = async (p: { method: PayMethod; cashReceived?: number; cashAmount?: number }) => {
    const payload: PosOrderInput = {
      sessionId: session.id,
      clientReference: newClientReference(),
      customerId: customerId || undefined,
      paymentMethod: p.method,
      cashReceived: p.cashReceived,
      cashAmount: p.method === 'split' ? p.cashAmount : undefined,
      lines: cart.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: lineAmounts(l).discount || undefined,
        taxRate: l.taxRate,
      })),
    };
    const cashDue = p.method === 'cash' ? totals.total : p.method === 'split' ? num(p.cashAmount) : 0;
    const change = p.cashReceived != null ? Math.max(0, p.cashReceived - cashDue) : 0;
    const finish = (info: { number: string; offline?: boolean }) => {
      setLastSale({ ...info, total: totals.total, change });
      setCart([]);
      setCustomerId('');
      setModal(null);
      barcodeRef.current?.focus();
    };
    setPaying(true);
    try {
      if (!navigator.onLine) throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
      const order = await opsPos.createOrder(payload);
      toast.success(t('msg.saleCompleted'));
      summary.refetch();
      finish({ number: order.orderNumber });
    } catch (err) {
      if (isNetworkError(err)) {
        saveQueue([...posStorage.getQueue(), { clientReference: payload.clientReference, payload, total: totals.total, createdAt: new Date().toISOString(), attempts: 0 }]);
        setOnline(false);
        toast.warning(t('pos.savedOffline'));
        finish({ number: payload.clientReference.slice(0, 8), offline: true });
      } else {
        toast.error(apiError(err, t('msg.error')));
      }
    } finally {
      setPaying(false);
    }
  };

  const pending = queue.filter((q) => !q.lastError).length;
  const failed = queue.filter((q) => q.lastError).length;

  return (
    <div className="space-y-3 -m-2">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-xl border border-gray-200 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">{session.terminalName || terminal?.name}</span>
          <span className="text-xs text-gray-500">{t('pos.openedAt')} {fmtDateTime(session.openedAt)}</span>
          <span className={clsx('inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full', online ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? t('pos.online') : t('pos.offline')}
          </span>
          {queue.length > 0 && (
            <button type="button" onClick={() => setModal('queue')} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
              <RefreshCw size={14} /> {t('pos.queued')}: {pending}
              {failed > 0 && ` / ${t('pos.failed')}: ${failed}`}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="secondary" onClick={() => setModal('orders')}>{t('pos.ordersAndRefunds')}</Btn>
          <Btn variant="secondary" onClick={() => setModal('cash')}>{t('pos.cashInOut')}</Btn>
          <Btn variant="secondary" onClick={() => setModal('report')}>{t('pos.xReport')}</Btn>
          <Btn variant="danger" onClick={() => setModal('close')} disabled={pending > 0} title={pending > 0 ? t('pos.syncBeforeClose') : undefined}>
            {t('pos.closeSession')}
          </Btn>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Products */}
        <div className="lg:col-span-3 space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              scan(barcode);
            }}
          >
            <div className="relative flex-1">
              <ScanLine className="absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                ref={barcodeRef}
                autoFocus
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    scan(barcode);
                  }
                }}
                placeholder={t('pos.scanPlaceholder')}
                className={`${inputCls} ps-10 text-lg py-3`}
              />
            </div>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.search')} className={`${inputCls} text-lg py-3 max-w-[220px]`} />
          </form>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button type="button" onClick={() => setCategoryId('')} className={clsx('px-4 py-2 rounded-full text-sm whitespace-nowrap', !categoryId ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200')}>
              {t('common.all')}
            </button>
            {categories.map((c) => (
              <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} className={clsx('px-4 py-2 rounded-full text-sm whitespace-nowrap', categoryId === c.id ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200')}>
                {name(c)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 max-h-[calc(100vh-280px)] overflow-y-auto">
            {products.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
            {visible.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="bg-white border border-gray-200 rounded-xl p-3 text-start hover:border-primary-400 hover:shadow active:scale-[0.98] transition min-h-[96px] flex flex-col justify-between"
              >
                <span className="font-medium text-gray-900 line-clamp-2">{name(p)}</span>
                <span className="flex justify-between items-end mt-2">
                  <span className="text-xs text-gray-400">{p.code}</span>
                  <span className="text-primary-700 font-semibold">{fmtMoney(p.sellPrice)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Cart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 flex flex-col min-h-[60vh]">
          <div className="p-3 border-b border-gray-200">
            <SelectBox value={customerId} onChange={setCustomerId} emptyLabel={t('pos.walkInCustomer')} options={toOptions(customers, name)} />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {cart.length === 0 && (
              <div className="p-8 text-center text-gray-400">
                {lastSale ? (
                  <div className="space-y-1">
                    <div className="text-green-700 font-semibold">
                      {lastSale.offline ? t('pos.savedOffline') : t('msg.saleCompleted')} {lastSale.number}
                    </div>
                    <div>{t('common.total')}: {fmtMoney(lastSale.total)}</div>
                    {lastSale.change > 0 && <div className="text-2xl text-gray-900">{t('pos.change')}: {fmtMoney(lastSale.change)}</div>}
                  </div>
                ) : (
                  t('pos.emptyCart')
                )}
              </div>
            )}
            {cart.map((l, i) => {
              const a = lineAmounts(l);
              const over = maxDiscount != null && effectiveDiscountPct(l) > maxDiscount + 0.0001;
              return (
                <div key={`${l.productId}-${i}`} className={clsx('p-3 space-y-2', selected === l.productId && 'bg-primary-50/40')} onClick={() => setSelected(l.productId)}>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{l.name}</span>
                    <span className="font-semibold">{fmtMoney(a.total)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" aria-label="-" onClick={() => updateLine(i, { quantity: Math.max(0, l.quantity - 1) })} className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Minus size={18} />
                    </button>
                    <input type="number" step="any" min="0" value={l.quantity} onChange={(e) => updateLine(i, { quantity: num(e.target.value) })} className={`${inputSm} w-20 text-center`} />
                    <button type="button" aria-label="+" onClick={() => updateLine(i, { quantity: l.quantity + 1 })} className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                      <Plus size={18} />
                    </button>
                    <span className="text-xs text-gray-500">×</span>
                    <input type="number" step="any" min="0" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: num(e.target.value) })} className={`${inputSm} w-24`} title={t('common.unitPrice')} />
                    <span className="text-xs text-gray-500">{t('pos.discountPct')}</span>
                    <input type="number" step="any" min="0" max="100" value={l.discountPct} onChange={(e) => updateLine(i, { discountPct: num(e.target.value) })} className={clsx(inputSm, 'w-16', over && 'border-red-500')} />
                    <button type="button" aria-label={t('common.remove')} onClick={() => setCart(cart.filter((_, idx) => idx !== i))} className="ms-auto p-2 text-red-500">
                      <Trash2 size={18} />
                    </button>
                  </div>
                  {over && <div className="text-xs text-red-600">{t('pos.overDiscount', { max: maxDiscount ?? 0 })}</div>}
                </div>
              );
            })}
          </div>
          <div className="p-3 border-t border-gray-200 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">{t('common.subtotal')}</span><span>{fmtMoney(totals.subtotal)}</span></div>
            {totals.discount > 0 && <div className="flex justify-between"><span className="text-gray-500">{t('common.discountAmount')}</span><span>-{fmtMoney(totals.discount)}</span></div>}
            <div className="flex justify-between"><span className="text-gray-500">{t('common.tax')}</span><span>{fmtMoney(totals.tax)}</span></div>
            <div className="flex justify-between text-2xl font-bold pt-1"><span>{t('common.total')}</span><span>{fmtMoney(totals.total)}</span></div>
            <div className="grid grid-cols-3 gap-2 pt-2">
              <Btn variant="secondary" size="lg" disabled={!cart.length} onClick={() => setCart([])}>{t('pos.clear')}</Btn>
              <Btn variant="success" size="lg" className="col-span-2 text-xl" disabled={!cart.length || totals.total <= 0 || cart.some((l) => l.quantity <= 0)} onClick={() => setModal('pay')}>
                {t('pos.pay')} {fmtMoney(totals.total)}
              </Btn>
            </div>
            {overLimit && <p className="text-xs text-amber-700">{t('pos.overrideNeeded')}</p>}
          </div>
        </div>
      </div>

      {modal === 'pay' && <PaymentModal total={totals.total} loading={paying} onClose={() => setModal(null)} onPay={pay} />}
      {modal === 'orders' && <OrdersModal sessionId={session.id} productName={(id) => (productMap[id] ? name(productMap[id]) : id)} onClose={() => setModal(null)} />}
      {modal === 'cash' && <CashModal sessionId={session.id} onClose={() => setModal(null)} />}
      {modal === 'close' && <CloseSessionModal sessionId={session.id} onClose={() => setModal(null)} onClosed={onEnd} />}
      {modal === 'report' && (
        <ReportModal onClose={() => setModal(null)}>
          <SessionReport summary={summary.data} />
        </ReportModal>
      )}
      {modal === 'queue' && (
        <ReportModal onClose={() => setModal(null)} title={t('pos.offlineQueue')}>
          <div className="space-y-2">
            {queue.map((q) => (
              <div key={q.clientReference} className="flex flex-wrap items-center justify-between gap-2 border border-gray-200 rounded-lg p-2 text-sm">
                <div>
                  <div className="font-mono text-xs">{q.clientReference}</div>
                  <div className="text-gray-500">{fmtDateTime(q.createdAt)} - {fmtMoney(q.total)}</div>
                  {q.lastError && <div className="text-red-600">{q.lastError}</div>}
                </div>
                <div className="flex gap-2">
                  {q.lastError && (
                    <Btn size="sm" variant="secondary" onClick={() => { saveQueue(queue.map((x) => (x.clientReference === q.clientReference ? { ...x, lastError: undefined } : x))); flush(); }}>
                      {t('pos.retry')}
                    </Btn>
                  )}
                  <Btn size="sm" variant="danger" onClick={() => saveQueue(queue.filter((x) => x.clientReference !== q.clientReference))}>{t('pos.discard')}</Btn>
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <Btn onClick={() => flush()}>{t('pos.syncNow')}</Btn>
            </div>
          </div>
        </ReportModal>
      )}
    </div>
  );
}

function ReportModal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title?: string }) {
  const t = useTranslations('ops');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">{title ?? t('pos.xReport')}</h2>
          <div className="flex gap-2 print:hidden">
            <Btn variant="secondary" onClick={() => window.print()}>{t('common.print')}</Btn>
            <Btn variant="secondary" onClick={onClose}>{t('common.close')}</Btn>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
