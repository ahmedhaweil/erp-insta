'use client';

import { useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clsx } from 'clsx';
import { useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import LeadForm from '@/components/people/LeadForm';
import { Field, Input, Select, Toolbar, useMoney } from '@/components/people/ui';
import { apiErrorMessage, useCrmStages, useLocalName, usePeopleMutation, usePeopleQuery, useUsers } from '@/hooks/use-people';
import { crmService, type CrmLead } from '@/services/people-crm.service';

/* Kanban board of open leads per stage; cards are dragged with native HTML5 drag and drop. */
export default function PipelinePage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const router = useRouter();
  const name = useLocalName();
  const money = useMoney();
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ search: '', assignedUserId: '', type: '' });
  const leadsKey = ['crm-leads', 'board', filters];
  const { data: stages = [], isLoading: stagesLoading } = useCrmStages();
  const { data: leads = [], isLoading } = usePeopleQuery(leadsKey, () => crmService.leads({ status: 'open', ...filters }));
  const { data: users = [] } = useUsers();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);

  const create = usePeopleMutation((body: Record<string, unknown>) => crmService.createLead(body), {
    invalidate: ['crm-leads'],
    success: t('leadCreated'),
    onSuccess: () => setCreatingIn(null),
  });

  const sorted = [...stages].sort((a, b) => a.sequence - b.sequence);

  const move = async (leadId: string, stageId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const previous = qc.getQueryData<CrmLead[]>(leadsKey);
    // optimistic update
    qc.setQueryData<CrmLead[]>(leadsKey, (list = []) => list.map((l) => (l.id === leadId ? { ...l, stageId } : l)));
    try {
      const updated = await crmService.moveStage(leadId, stageId);
      if (updated.status === 'won') toast.success(t('leadWon'));
      else toast.success(t('stageChanged'));
      qc.invalidateQueries({ queryKey: ['crm-leads'] });
    } catch (err) {
      qc.setQueryData(leadsKey, previous);
      toast.error(apiErrorMessage(err, tc('error')));
    }
  };

  const onDrop = (e: DragEvent, stageId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain') || dragging;
    setOver(null);
    setDragging(null);
    if (leadId) void move(leadId, stageId);
  };

  return (
    <div>
      <PageHeader title={t('pipeline')} action={{ label: t('newLead'), onClick: () => setCreatingIn(sorted[0]?.id ?? '') }} />
      <Toolbar>
        <Field label={tc('search')}>
          <Input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} />
        </Field>
        <Field label={t('salesperson')}>
          <Select value={filters.assignedUserId} onChange={(e) => setFilters((f) => ({ ...f, assignedUserId: e.target.value }))} placeholder={tc('all')} options={users.map((u) => ({ value: u.id, label: u.name ?? u.id }))} />
        </Field>
        <Field label={t('type')}>
          <Select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} placeholder={tc('all')} options={['lead', 'opportunity'].map((v) => ({ value: v, label: t(`type_${v}`) }))} />
        </Field>
        <p className="text-xs text-gray-500">{t('dragHint')}</p>
      </Toolbar>
      {stagesLoading || isLoading ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 items-start">
          {sorted.map((stage) => {
            const cards = leads.filter((l) => l.stageId === stage.id);
            const total = cards.reduce((s, l) => s + Number(l.expectedRevenue || 0), 0);
            return (
              <div
                key={stage.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== stage.id) setOver(stage.id);
                }}
                onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
                onDrop={(e) => onDrop(e, stage.id)}
                className={clsx(
                  'w-72 flex-shrink-0 rounded-xl border bg-gray-100 transition',
                  over === stage.id ? 'border-primary-500 bg-primary-50' : 'border-gray-200',
                )}
              >
                <div className="px-3 py-2 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-800">
                      {name(stage)}
                      {stage.isWon && <span className="ms-1 text-xs text-green-700">({t('wonStage')})</span>}
                    </span>
                    <span className="text-xs bg-white rounded-full px-2 py-0.5">{cards.length}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {money(total)} · {Number(stage.probability)}%
                  </div>
                </div>
                <div className="p-2 space-y-2 min-h-24">
                  {cards.map((lead) => (
                    <div
                      key={lead.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', lead.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(lead.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      onClick={() => router.push(`/crm/leads/${lead.id}`)}
                      className={clsx(
                        'bg-white rounded-lg border border-gray-200 p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow',
                        dragging === lead.id && 'opacity-50',
                      )}
                    >
                      <div className="text-sm font-medium text-gray-900">{lead.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {lead.customer ? name(lead.customer) : lead.companyName || lead.contactName || '-'}
                      </div>
                      <div className="flex justify-between items-center mt-2 text-xs">
                        <span className="font-semibold text-gray-800">{money(lead.expectedRevenue)}</span>
                        <span className="text-gray-500">{Number(lead.probability)}%</span>
                      </div>
                      <div className="flex justify-between items-center mt-1 text-xs text-gray-400">
                        <span>{lead.leadNumber}</span>
                        <span>{t(`type_${lead.type}`)}</span>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => setCreatingIn(stage.id)} className="w-full text-xs text-gray-500 hover:text-primary-600 py-1">
                    + {t('quickAdd')}
                  </button>
                </div>
              </div>
            );
          })}
          {!sorted.length && <p className="text-gray-500">{t('noStages')}</p>}
        </div>
      )}
      <Modal isOpen={creatingIn !== null} onClose={() => setCreatingIn(null)} title={t('newLead')} size="xl">
        {creatingIn !== null && (
          <LeadForm compact defaultStageId={creatingIn} submitting={create.isPending} onSubmit={(body) => create.mutate(body)} onCancel={() => setCreatingIn(null)} />
        )}
      </Modal>
    </div>
  );
}
