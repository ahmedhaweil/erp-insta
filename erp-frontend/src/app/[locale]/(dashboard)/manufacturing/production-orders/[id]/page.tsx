'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Button, Card, Checkbox, Field, FormActions, Input, KeyValue, SimpleTable, Tabs, num, td, todayIso, useMoney } from '@/components/people/ui';
import { useLabelMap, usePeopleMutation, usePeopleQuery, useProducts, useWarehouses } from '@/hooks/use-people';
import { mfgService, type ProductionOrder } from '@/services/people-manufacturing.service';

type Tab = 'lines' | 'availability' | 'cost' | 'runs' | 'scrap';
const COLORS: Record<string, string> = { draft: 'draft', confirmed: 'confirmed', in_progress: 'pending', done: 'completed', cancelled: 'cancelled' };

function ProduceDialog({ order, labels, onClose }: { order: ProductionOrder; labels: Map<string, string>; onClose: () => void }) {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const remaining = Math.max(Number(order.plannedQuantity) - Number(order.producedQuantity), 0);
  const [quantity, setQuantity] = useState(String(remaining || 1));
  const [date, setDate] = useState(todayIso());
  const [finish, setFinish] = useState(false);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const ratio = Number(quantity || 0) / Number(order.plannedQuantity || 1);
  const lines = order.lines ?? [];
  const expected = (planned: number | string) => Math.round(Number(planned) * ratio * 10000) / 10000;

  const produce = usePeopleMutation(
    () =>
      mfgService.produce(order.id, {
        quantity: Number(quantity),
        date,
        finish: finish || undefined,
        consumption: Object.entries(actuals)
          .filter(([, v]) => v !== '')
          .map(([productId, v]) => ({ productId, quantity: Number(v) })),
      }),
    { invalidate: ['mfg-orders', 'mfg-scraps'], success: t('produced'), onSuccess: onClose },
  );

  return (
    <Modal isOpen onClose={onClose} title={`${t('produce')}: ${order.orderNumber}`} size="lg">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); produce.mutate(undefined); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('quantityProduced')} required hint={`${t('remaining')}: ${num(remaining)}`}>
            <Input type="number" step="any" min="0.0001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label={tc('date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-gray-500">{t('actualConsumptionHint')}</p>
        <SimpleTable headers={[t('product'), t('lineType'), t('expected'), t('actual')]}>
          {lines.map((l) => (
            <tr key={l.id}>
              <td className={td}>{labels.get(l.productId) ?? l.product?.code}</td>
              <td className={td}>{t(`type_${l.type}`)}</td>
              <td className={td}>{num(expected(l.plannedQuantity))}</td>
              <td className={td}>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  className="w-32"
                  placeholder={String(expected(l.plannedQuantity))}
                  value={actuals[l.productId] ?? ''}
                  onChange={(e) => setActuals((a) => ({ ...a, [l.productId]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </SimpleTable>
        <Checkbox label={t('finishAfterRun')} checked={finish} onChange={setFinish} />
        <FormActions onCancel={onClose} submitting={produce.isPending} submitLabel={t('produce')} />
      </form>
    </Modal>
  );
}

export default function ProductionOrderPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const router = useRouter();
  const money = useMoney();
  const { data: order, isLoading } = usePeopleQuery(['mfg-orders', id], () => mfgService.order(id));
  const { data: products } = useProducts();
  const { data: warehouses } = useWarehouses();
  const labels = useLabelMap(products);
  const whMap = useLabelMap(warehouses);
  const [tab, setTab] = useState<Tab>('lines');
  const [dialog, setDialog] = useState<'confirm' | 'produce' | 'cancel' | 'delete' | 'scrap' | null>(null);
  const [confirmOpts, setConfirmOpts] = useState({ reserve: true, allowShortage: false });
  const [scrap, setScrap] = useState({ productId: '', quantity: '1', reason: '', date: todayIso() });
  const status = order?.status;
  const { data: availability, isLoading: availLoading } = usePeopleQuery(['mfg-orders', id, 'availability'], () => mfgService.availability(id), tab === 'availability' || dialog === 'confirm');
  const { data: cost } = usePeopleQuery(['mfg-orders', id, 'cost'], () => mfgService.orderCost(id), tab === 'cost');
  const { data: runs = [] } = usePeopleQuery(['mfg-orders', id, 'runs'], () => mfgService.orderRuns(id), tab === 'runs');
  const { data: scraps = [] } = usePeopleQuery(['mfg-scraps', id], () => mfgService.scraps(id), tab === 'scrap');

  const invalidate = ['mfg-orders', 'mfg-scraps'];
  const close = { onSuccess: () => setDialog(null) };
  const confirm = usePeopleMutation(() => mfgService.confirmOrder(id, confirmOpts), { invalidate, success: t('orderConfirmed'), ...close });
  const start = usePeopleMutation(() => mfgService.startOrder(id), { invalidate, success: t('orderStarted') });
  const finish = usePeopleMutation(() => mfgService.finishOrder(id), { invalidate, success: t('orderFinished') });
  const cancel = usePeopleMutation(() => mfgService.cancelOrder(id), { invalidate, success: t('orderCancelled'), ...close });
  const remove = usePeopleMutation(() => mfgService.deleteOrder(id), { invalidate, success: tc('deleteSuccess'), onSuccess: () => router.push('/manufacturing/production-orders') });
  const createScrap = usePeopleMutation(
    () => mfgService.createScrap({ productionOrderId: id, productId: scrap.productId, quantity: Number(scrap.quantity), reason: scrap.reason, date: scrap.date }),
    { invalidate, success: t('scrapRecorded'), ...close },
  );

  if (isLoading || !order) return <div className="text-gray-500">{tc('loading')}</div>;
  const shortages = (availability ?? []).filter((a) => a.shortage > 0);
  const open = status === 'confirmed' || status === 'in_progress';

  return (
    <div className="space-y-4">
      <PageHeader title={`${order.orderNumber} - ${labels.get(order.productId) ?? ''}`} />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={COLORS[order.status]} label={t(`status_${order.status}`)} />
        <div className="flex-1" />
        {status === 'draft' && (
          <>
            <Button variant="success" onClick={() => setDialog('confirm')}>{t('confirm')}</Button>
            <Button variant="danger" onClick={() => setDialog('delete')}>{tc('delete')}</Button>
          </>
        )}
        {status === 'confirmed' && <Button onClick={() => start.mutate(undefined)} disabled={start.isPending}>{t('start')}</Button>}
        {open && (
          <>
            <Button variant="success" onClick={() => setDialog('produce')}>{t('produce')}</Button>
            <Button variant="secondary" onClick={() => finish.mutate(undefined)} disabled={finish.isPending || Number(order.producedQuantity) <= 0}>{t('finish')}</Button>
          </>
        )}
        {(open || status === 'done') && (
          <Button variant="secondary" onClick={() => { setScrap({ productId: order.productId, quantity: '1', reason: '', date: todayIso() }); setDialog('scrap'); }}>
            {t('recordScrap')}
          </Button>
        )}
        {(status === 'draft' || open) && Number(order.producedQuantity) === 0 && (
          <Button variant="danger" onClick={() => setDialog('cancel')}>{tc('cancel')}</Button>
        )}
      </div>

      <Card>
        <KeyValue
          items={[
            { label: t('planned'), value: num(order.plannedQuantity) },
            { label: t('produced'), value: num(order.producedQuantity) },
            { label: t('sourceWarehouse'), value: whMap.get(order.sourceWarehouseId) },
            { label: t('destinationWarehouse'), value: whMap.get(order.destinationWarehouseId) },
            { label: t('plannedDate'), value: order.plannedDate ?? '-' },
            { label: t('completedDate'), value: order.completedDate ?? '-' },
            { label: t('standardUnitCost'), value: money(order.standardUnitCost, 4) },
            { label: t('actualMaterial'), value: money(order.actualComponentCost) },
            { label: t('actualLabour'), value: money(order.actualLabourCost) },
            { label: t('actualOverhead'), value: money(order.actualOverheadCost) },
            { label: t('scrapCost'), value: money(order.scrapCost) },
            { label: t('exploded'), value: order.exploded ? tc('yes') : tc('no') },
          ]}
        />
      </Card>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'lines', label: t('lines') },
          { key: 'availability', label: t('availability') },
          { key: 'cost', label: t('costReport') },
          { key: 'runs', label: t('runs') },
          { key: 'scrap', label: t('scraps') },
        ]}
      />

      {tab === 'lines' && (
        <SimpleTable headers={[t('product'), t('lineType'), t('planned'), t('done'), t('reserved'), t('scrapPct'), t('costShare'), t('standardUnitCost'), t('actualCost')]}>
          {(order.lines ?? []).map((l) => (
            <tr key={l.id}>
              <td className={td}>{labels.get(l.productId) ?? l.product?.code}</td>
              <td className={td}>{t(`type_${l.type}`)}</td>
              <td className={td}>{num(l.plannedQuantity)}</td>
              <td className={td}>{num(l.doneQuantity)}</td>
              <td className={td}>{num(l.reservedQuantity)}</td>
              <td className={td}>{num(l.scrapPercent, 2)}%</td>
              <td className={td}>{l.type === 'by_product' ? `${num(l.costSharePercent, 2)}%` : '-'}</td>
              <td className={td}>{money(l.standardUnitCost, 4)}</td>
              <td className={td}>{money(l.actualCost)}</td>
            </tr>
          ))}
        </SimpleTable>
      )}

      {tab === 'availability' &&
        (availLoading ? (
          <div className="text-gray-500">{tc('loading')}</div>
        ) : (
          <SimpleTable headers={[t('product'), t('required'), t('available'), t('shortage')]}>
            {(availability ?? []).map((a) => (
              <tr key={a.productId} className={a.shortage > 0 ? 'bg-red-50' : undefined}>
                <td className={td}>{labels.get(a.productId)}</td>
                <td className={td}>{num(a.required)}</td>
                <td className={td}>{num(a.available)}</td>
                <td className={`${td} ${a.shortage > 0 ? 'text-red-700 font-semibold' : ''}`}>{num(a.shortage)}</td>
              </tr>
            ))}
          </SimpleTable>
        ))}

      {tab === 'cost' && cost && (
        <div className="space-y-4">
          <SimpleTable headers={['', t('material'), t('labour'), t('overhead'), t('byProductCost'), t('totalCost'), t('unitCost')]}>
            {(['standard', 'actual'] as const).map((k) => (
              <tr key={k}>
                <td className={`${td} font-medium`}>{t(k)}</td>
                <td className={td}>{money(cost[k].material)}</td>
                <td className={td}>{money(cost[k].labour)}</td>
                <td className={td}>{money(cost[k].overhead)}</td>
                <td className={td}>{money(cost[k].byProductCost)}</td>
                <td className={td}>{money(cost[k].total)}</td>
                <td className={td}>{money(cost[k].unitCost, 4)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>{t('variance')}</td>
              <td className={td}>{money(cost.variance.material)}</td>
              <td className={td} colSpan={3} />
              <td className={`${td} ${cost.variance.total > 0 ? 'text-red-700' : 'text-green-700'}`}>{money(cost.variance.total)}</td>
              <td />
            </tr>
          </SimpleTable>
          <p className="text-xs text-gray-500">{t('costBasis', { qty: num(cost.costBasisQuantity) })} | {t('scrapCost')}: {money(cost.scrapCost)}</p>
          <SimpleTable headers={[t('product'), t('stdQty'), t('stdCost'), t('actQty'), t('actCost'), t('usageVariance'), t('priceVariance'), t('totalVariance')]}>
            {cost.components.map((c) => (
              <tr key={c.productId}>
                <td className={td}>{c.productCode} {c.productName}</td>
                <td className={td}>{num(c.standardQuantity)}</td>
                <td className={td}>{money(c.standardCost)}</td>
                <td className={td}>{num(c.actualQuantity)}</td>
                <td className={td}>{money(c.actualCost)}</td>
                <td className={td}>{money(c.usageVariance)}</td>
                <td className={td}>{money(c.priceVariance)}</td>
                <td className={td}>{money(c.totalVariance)}</td>
              </tr>
            ))}
          </SimpleTable>
        </div>
      )}

      {tab === 'runs' && (
        <div className="space-y-3">
          {runs.map((r, i) => (
            <Card key={r.id} title={`#${i + 1} | ${String(r.date).slice(0, 10)} | ${t('quantityProduced')}: ${num(r.quantity)} | ${t('unitCost')}: ${money(r.unitCost, 4)}`}>
              <p className="text-xs text-gray-500 mb-2">
                {t('material')}: {money(r.componentCost)} | {t('labour')}: {money(r.labourCost)} | {t('overhead')}: {money(r.overheadCost)} | {t('byProductCost')}: {money(r.byProductCost)}
              </p>
              <SimpleTable headers={[t('product'), t('lineType'), t('expected'), t('actual'), t('unitCost'), t('cost')]}>
                {r.moves.map((m, j) => (
                  <tr key={j}>
                    <td className={td}>{labels.get(m.productId)}</td>
                    <td className={td}>{t(`type_${m.type}`)}</td>
                    <td className={td}>{num(m.expectedQuantity)}</td>
                    <td className={`${td} ${m.quantity !== m.expectedQuantity ? 'text-amber-700 font-semibold' : ''}`}>{num(m.quantity)}</td>
                    <td className={td}>{money(m.unitCost, 4)}</td>
                    <td className={td}>{money(m.cost)}</td>
                  </tr>
                ))}
              </SimpleTable>
            </Card>
          ))}
          {!runs.length && <p className="text-gray-500 text-sm">{t('noRuns')}</p>}
        </div>
      )}

      {tab === 'scrap' && (
        <SimpleTable headers={[t('scrapNumber'), tc('date'), t('product'), tc('quantity'), t('cost'), t('reason')]}>
          {scraps.map((s) => (
            <tr key={s.id}>
              <td className={td}>{s.scrapNumber}</td>
              <td className={td}>{String(s.date).slice(0, 10)}</td>
              <td className={td}>{labels.get(s.productId)}</td>
              <td className={td}>{num(s.quantity)}</td>
              <td className={td}>{money(s.cost)}</td>
              <td className={td}>{s.reason || '-'}</td>
            </tr>
          ))}
        </SimpleTable>
      )}

      {dialog === 'produce' && <ProduceDialog order={order} labels={labels} onClose={() => setDialog(null)} />}

      <Modal isOpen={dialog === 'confirm'} onClose={() => setDialog(null)} title={t('confirm')}>
        <form onSubmit={(e) => { e.preventDefault(); confirm.mutate(undefined); }} className="space-y-4">
          {shortages.length > 0 ? (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {t('shortageWarning')}
              <ul className="list-disc ps-5 mt-1">
                {shortages.map((s) => (
                  <li key={s.productId}>{labels.get(s.productId)}: {num(s.shortage)}</li>
                ))}
              </ul>
            </div>
          ) : (
            availability && <p className="text-sm text-green-700">{t('allAvailable')}</p>
          )}
          <Checkbox label={t('reserveComponents')} checked={confirmOpts.reserve} onChange={(v) => setConfirmOpts((o) => ({ ...o, reserve: v }))} />
          <div />
          <Checkbox label={t('allowShortage')} checked={confirmOpts.allowShortage} onChange={(v) => setConfirmOpts((o) => ({ ...o, allowShortage: v }))} />
          <FormActions onCancel={() => setDialog(null)} submitting={confirm.isPending} submitLabel={t('confirm')} />
        </form>
      </Modal>

      <Modal isOpen={dialog === 'scrap'} onClose={() => setDialog(null)} title={t('recordScrap')}>
        <form onSubmit={(e) => { e.preventDefault(); createScrap.mutate(undefined); }} className="space-y-4">
          <Field label={t('product')} required>
            <select
              required
              value={scrap.productId}
              onChange={(e) => setScrap((s) => ({ ...s, productId: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg"
            >
              {[order.productId, ...(order.lines ?? []).map((l) => l.productId)].filter((v, i, a) => a.indexOf(v) === i).map((pid) => (
                <option key={pid} value={pid}>{labels.get(pid)}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={tc('quantity')} required>
              <Input type="number" step="any" min="0.0001" required value={scrap.quantity} onChange={(e) => setScrap((s) => ({ ...s, quantity: e.target.value }))} />
            </Field>
            <Field label={tc('date')}>
              <Input type="date" value={scrap.date} onChange={(e) => setScrap((s) => ({ ...s, date: e.target.value }))} />
            </Field>
          </div>
          <Field label={t('reason')}>
            <Input value={scrap.reason} onChange={(e) => setScrap((s) => ({ ...s, reason: e.target.value }))} />
          </Field>
          <FormActions onCancel={() => setDialog(null)} submitting={createScrap.isPending} submitLabel={t('recordScrap')} />
        </form>
      </Modal>

      <ConfirmDialog isOpen={dialog === 'cancel'} onClose={() => setDialog(null)} onConfirm={() => cancel.mutate(undefined)} title={tc('cancel')} message={t('cancelOrderConfirm')} destructive loading={cancel.isPending} />
      <ConfirmDialog isOpen={dialog === 'delete'} onClose={() => setDialog(null)} onConfirm={() => remove.mutate(undefined)} title={tc('delete')} message={tc('confirmDelete')} destructive loading={remove.isPending} />
    </div>
  );
}
