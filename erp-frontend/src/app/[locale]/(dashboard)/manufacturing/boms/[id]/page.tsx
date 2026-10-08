'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import StatusBadge from '@/components/ui/StatusBadge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Button, Card, Checkbox, ErrorBox, Field, Input, Select, SimpleTable, Tabs, TextArea, Toolbar, num, td, useMoney } from '@/components/people/ui';
import { apiErrorMessage, useLabelMap, usePeopleMutation, usePeopleQuery, useProducts } from '@/hooks/use-people';
import { mfgService, type Bom, type BomInput, type ExplosionNode } from '@/services/people-manufacturing.service';

type Tab = 'structure' | 'explode' | 'cost';
interface LineState {
  productId: string;
  quantity: string;
  percent: string;
}

function linesOf(bom: Bom | undefined, type: 'component' | 'by_product'): LineState[] {
  return (bom?.lines ?? [])
    .filter((l) => l.type === type)
    .map((l) => ({
      productId: l.productId,
      quantity: String(Number(l.quantity)),
      percent: String(Number(type === 'component' ? l.scrapPercent : l.costSharePercent)),
    }));
}

function LinesEditor({ title, lines, setLines, percentLabel, options }: { title: string; lines: LineState[]; setLines: (l: LineState[]) => void; percentLabel: string; options: { value: string; label: string }[] }) {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const update = (i: number, patch: Partial<LineState>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div>
      <h3 className="font-medium text-gray-900 mb-2">{title}</h3>
      <div className="space-y-2">
        {lines.length > 0 && (
          <div className="grid grid-cols-12 gap-2 text-xs text-gray-500">
            <span className="col-span-6">{t('product')}</span>
            <span className="col-span-2">{tc('quantity')}</span>
            <span className="col-span-3">{percentLabel}</span>
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <Select className="col-span-6" required value={l.productId} onChange={(e) => update(i, { productId: e.target.value })} placeholder={tp('select')} options={options} />
            <Input className="col-span-2" type="number" step="any" min="0.0001" required value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
            <Input className="col-span-3" type="number" step="any" min={0} max={100} value={l.percent} onChange={(e) => update(i, { percent: e.target.value })} />
            <button type="button" className="col-span-1 text-red-600 text-sm hover:underline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              {tp('remove')}
            </button>
          </div>
        ))}
      </div>
      <Button variant="ghost" className="mt-2" onClick={() => setLines([...lines, { productId: '', quantity: '1', percent: '0' }])}>
        + {tp('addLine')}
      </Button>
    </div>
  );
}

function TreeNode({ node, labels }: { node: ExplosionNode; labels: Map<string, string> }) {
  const t = useTranslations('mfg');
  return (
    <li className="py-0.5">
      <span className={node.children?.length ? 'font-medium' : undefined}>{labels.get(node.productId) ?? node.productId}</span>
      <span className="text-gray-500"> × {num(node.quantity)}</span>
      {Number(node.scrapPercent) > 0 && <span className="text-xs text-amber-600 ms-1">({t('scrapPct')} {num(node.scrapPercent, 2)}%)</span>}
      {node.bomId && <span className="text-xs text-primary-600 ms-1">[{t('subAssembly')}]</span>}
      {node.children?.length ? (
        <ul className="ps-6 border-s border-gray-200 ms-1">
          {node.children.map((c, i) => (
            <TreeNode key={`${c.productId}-${i}`} node={c} labels={labels} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ExplodeTab({ bom, labels }: { bom: Bom; labels: Map<string, string> }) {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const [qty, setQty] = useState(String(Number(bom.outputQuantity)));
  const [multi, setMulti] = useState(true);
  const [applied, setApplied] = useState({ qty: Number(bom.outputQuantity), multi: true });
  const { data, isLoading } = usePeopleQuery(['mfg-boms', bom.id, 'explode', applied], () => mfgService.explode(bom.id, applied.qty, applied.multi));
  const money = useMoney();
  return (
    <div className="space-y-4">
      <Toolbar>
        <Field label={tc('quantity')}>
          <Input type="number" step="any" min="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Checkbox label={t('multiLevel')} checked={multi} onChange={setMulti} />
        <Button onClick={() => setApplied({ qty: Number(qty), multi })}>{t('explode')}</Button>
      </Toolbar>
      {isLoading || !data ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title={t('structureTree')}>
            <div className="text-sm font-semibold mb-1">
              {labels.get(data.productId)} × {num(data.quantity)}
            </div>
            <ul className="text-sm">
              {data.tree.map((n, i) => (
                <TreeNode key={`${n.productId}-${i}`} node={n} labels={labels} />
              ))}
            </ul>
            <p className="text-xs text-gray-500 mt-3">
              {t('labour')}: {money(data.labourCost)} | {t('overhead')}: {money(data.overheadCost)}
            </p>
          </Card>
          <div className="space-y-4">
            <Card title={t('leafComponents')}>
              <SimpleTable headers={[t('product'), tc('quantity'), t('level')]}>
                {data.components.map((c) => (
                  <tr key={c.productId}>
                    <td className={td}>{labels.get(c.productId)}</td>
                    <td className={td}>{num(c.quantity)}</td>
                    <td className={td}>{c.level}</td>
                  </tr>
                ))}
              </SimpleTable>
            </Card>
            {data.byProducts.length > 0 && (
              <Card title={t('byProducts')}>
                <SimpleTable headers={[t('product'), tc('quantity'), t('costShare')]}>
                  {data.byProducts.map((c) => (
                    <tr key={c.productId}>
                      <td className={td}>{labels.get(c.productId)}</td>
                      <td className={td}>{num(c.quantity)}</td>
                      <td className={td}>{num(c.costSharePercent, 2)}%</td>
                    </tr>
                  ))}
                </SimpleTable>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CostTab({ bom }: { bom: Bom }) {
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const money = useMoney();
  const [qty, setQty] = useState(String(Number(bom.outputQuantity)));
  const [applied, setApplied] = useState(Number(bom.outputQuantity));
  const { data, isLoading } = usePeopleQuery(['mfg-boms', bom.id, 'cost', applied], () => mfgService.bomCost(bom.id, applied));
  return (
    <div className="space-y-4">
      <Toolbar>
        <Field label={tc('quantity')}>
          <Input type="number" step="any" min="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Button onClick={() => setApplied(Number(qty))}>{t('rollup')}</Button>
      </Toolbar>
      {isLoading || !data ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <>
          <SimpleTable
            headers={[tc('code'), t('product'), tc('quantity'), t('unitCost'), t('cost'), t('costSource')]}
            footer={
              <tr>
                <td className={td} colSpan={4}>{t('materialCost')}</td>
                <td className={td}>{money(data.materialCost)}</td>
                <td />
              </tr>
            }
          >
            {data.lines.map((l) => (
              <tr key={l.productId}>
                <td className={td}>{l.productCode}</td>
                <td className={td}>{l.productName}</td>
                <td className={td}>{num(l.quantity)}</td>
                <td className={td}>{money(l.unitCost, 4)}</td>
                <td className={td}>{money(l.cost)}</td>
                <td className={td}>{t(`source_${l.costSource}`)}</td>
              </tr>
            ))}
          </SimpleTable>
          <Card>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><div className="text-gray-500">{t('labour')}</div><div className="font-semibold">{money(data.labourCost)}</div></div>
              <div><div className="text-gray-500">{t('overhead')}</div><div className="font-semibold">{money(data.overheadCost)}</div></div>
              <div><div className="text-gray-500">{t('byProductCost')}</div><div className="font-semibold">-{money(data.byProductCost)}</div></div>
              <div><div className="text-gray-500">{t('totalCost')}</div><div className="font-semibold">{money(data.totalCost)}</div></div>
              <div><div className="text-gray-500">{t('unitCost')}</div><div className="font-bold text-primary-700">{money(data.unitCost, 4)}</div></div>
              <div><div className="text-gray-500">{t('currentAverageCost')}</div><div className="font-semibold">{money(data.currentAverageCost, 4)}</div></div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default function BomPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const t = useTranslations('mfg');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const router = useRouter();
  const { data: bom } = usePeopleQuery(['mfg-boms', id], () => mfgService.bom(id), !isNew);
  const { data: products } = useProducts();
  const labels = useLabelMap(products);
  const productOptions = [...labels].map(([value, label]) => ({ value, label }));
  const [tab, setTab] = useState<Tab>('structure');
  const [form, setForm] = useState({ productId: '', name: '', outputQuantity: '1', labourCostPerUnit: '0', overheadCostPerUnit: '0', notes: '', isActive: true });
  const [components, setComponents] = useState<LineState[]>([{ productId: '', quantity: '1', percent: '0' }]);
  const [byProducts, setByProducts] = useState<LineState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activateNew, setActivateNew] = useState(false);

  useEffect(() => {
    if (!bom) return;
    setForm({
      productId: bom.productId,
      name: bom.name ?? '',
      outputQuantity: String(Number(bom.outputQuantity)),
      labourCostPerUnit: String(Number(bom.labourCostPerUnit)),
      overheadCostPerUnit: String(Number(bom.overheadCostPerUnit)),
      notes: bom.notes ?? '',
      isActive: bom.isActive,
    });
    setComponents(linesOf(bom, 'component'));
    setByProducts(linesOf(bom, 'by_product'));
  }, [bom]);

  const invalidate = ['mfg-boms'];
  const save = usePeopleMutation((body: BomInput) => (isNew ? mfgService.createBom(body) : mfgService.updateBom(id, body)), {
    invalidate,
    success: t('bomSaved'),
    onSuccess: (saved) => {
      setError(null);
      if (isNew) router.replace(`/manufacturing/boms/${saved.id}`);
    },
  });
  const toggle = usePeopleMutation(() => (bom?.isActive ? mfgService.deactivateBom(id) : mfgService.activateBom(id)), { invalidate });
  const newVersion = usePeopleMutation(() => mfgService.newBomVersion(id, activateNew), {
    invalidate,
    success: t('versionCreated'),
    onSuccess: (created) => router.push(`/manufacturing/boms/${created.id}`),
  });
  const remove = usePeopleMutation(() => mfgService.deleteBom(id), {
    invalidate,
    success: tc('deleteSuccess'),
    onSuccess: () => router.push('/manufacturing/boms'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: BomInput = {
      productId: form.productId,
      name: form.name || undefined,
      outputQuantity: Number(form.outputQuantity || 1),
      labourCostPerUnit: Number(form.labourCostPerUnit || 0),
      overheadCostPerUnit: Number(form.overheadCostPerUnit || 0),
      notes: form.notes || undefined,
      components: components.map((c) => ({ productId: c.productId, quantity: Number(c.quantity), scrapPercent: Number(c.percent || 0) })),
      byProducts: byProducts.map((c) => ({ productId: c.productId, quantity: Number(c.quantity), costSharePercent: Number(c.percent || 0) })),
    };
    if (isNew) body.isActive = form.isActive;
    save.mutate(body, { onError: (err) => setError(apiErrorMessage(err, tc('error'))) });
  };

  const set = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const structure = (
    <form onSubmit={submit} className="space-y-6">
      <ErrorBox message={error} />
      <Card title={t('bomHeader')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t('finishedProduct')} required>
            <Select required disabled={!isNew} value={form.productId} onChange={(e) => set('productId', e.target.value)} placeholder={tp('select')} options={productOptions} />
          </Field>
          <Field label={tc('name')}>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label={t('outputQuantity')} hint={t('outputQuantityHint')}>
            <Input type="number" step="any" min="0.0001" value={form.outputQuantity} onChange={(e) => set('outputQuantity', e.target.value)} />
          </Field>
          <Field label={t('labourPerUnit')}>
            <Input type="number" step="any" min={0} value={form.labourCostPerUnit} onChange={(e) => set('labourCostPerUnit', e.target.value)} />
          </Field>
          <Field label={t('overheadPerUnit')}>
            <Input type="number" step="any" min={0} value={form.overheadCostPerUnit} onChange={(e) => set('overheadCostPerUnit', e.target.value)} />
          </Field>
          {isNew && (
            <div className="flex items-end">
              <Checkbox label={t('makeActive')} checked={form.isActive} onChange={(v) => set('isActive', v)} />
            </div>
          )}
        </div>
        <Field label={tc('notes')} className="mt-4">
          <TextArea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </Card>
      <Card>
        <LinesEditor title={t('components')} lines={components} setLines={setComponents} percentLabel={t('scrapPct')} options={productOptions.filter((o) => o.value !== form.productId)} />
      </Card>
      <Card>
        <LinesEditor title={t('byProducts')} lines={byProducts} setLines={setByProducts} percentLabel={t('costShare')} options={productOptions.filter((o) => o.value !== form.productId)} />
      </Card>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.push('/manufacturing/boms')}>{tc('back')}</Button>
        <Button type="submit" disabled={save.isPending}>{save.isPending ? tc('loading') : tc('save')}</Button>
      </div>
    </form>
  );

  if (isNew) {
    return (
      <div>
        <PageHeader title={t('newBom')} />
        {structure}
      </div>
    );
  }
  if (!bom) return <div className="text-gray-500">{tc('loading')}</div>;

  return (
    <div>
      <PageHeader title={`${bom.code} v${bom.version} - ${labels.get(bom.productId) ?? ''}`} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <StatusBadge status={bom.isActive ? 'active' : 'inactive'} label={bom.isActive ? tc('active') : tc('inactive')} />
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => toggle.mutate(undefined)} disabled={toggle.isPending}>
          {bom.isActive ? t('deactivate') : t('activate')}
        </Button>
        <Checkbox label={t('activateNewVersion')} checked={activateNew} onChange={setActivateNew} />
        <Button variant="secondary" onClick={() => newVersion.mutate(undefined)} disabled={newVersion.isPending}>
          {t('newVersion')}
        </Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>{tc('delete')}</Button>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'structure', label: t('structure') },
          { key: 'explode', label: t('explodeTree') },
          { key: 'cost', label: t('costRollup') },
        ]}
      />
      {tab === 'structure' && structure}
      {tab === 'explode' && <ExplodeTab bom={bom} labels={labels} />}
      {tab === 'cost' && <CostTab bom={bom} />}
      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate(undefined)}
        title={tc('delete')}
        message={tc('confirmDelete')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}
