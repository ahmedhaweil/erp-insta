import api from '@/lib/api';
import { clean } from './people-hr.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const data = <T = any>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export interface CrmStage {
  id: string;
  name: string;
  nameAr?: string | null;
  sequence: number;
  probability: number | string;
  isWon: boolean;
  isActive: boolean;
}

export type LeadStatus = 'open' | 'won' | 'lost';
export type LeadType = 'lead' | 'opportunity';
export const LEAD_SOURCES = [
  'website', 'phone', 'email', 'referral', 'walk_in', 'social_media', 'campaign', 'exhibition', 'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export interface CrmLead {
  id: string;
  leadNumber: string;
  title: string;
  type: LeadType;
  status: LeadStatus;
  stageId?: string | null;
  probability: number | string;
  expectedRevenue: number | string;
  expectedCloseDate?: string | null;
  source: LeadSource;
  assignedUserId?: string | null;
  customerId?: string | null;
  contactName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  lostReason?: string | null;
  closedDate?: string | null;
  salesOrderId?: string | null;
  stage?: CrmStage | null;
  customer?: { id: string; code?: string; nameAr?: string; nameEn?: string } | null;
}

export const ACTIVITY_TYPES = ['call', 'meeting', 'task', 'email'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityState = 'planned' | 'overdue' | 'today' | 'done' | 'cancelled';

export interface CrmActivity {
  id: string;
  type: ActivityType;
  subject: string;
  notes?: string | null;
  dueDate: string;
  leadId?: string | null;
  customerId?: string | null;
  assignedUserId: string;
  status: 'planned' | 'done' | 'cancelled';
  result?: string | null;
  state: ActivityState;
}

export interface PipelineBucket {
  openCount: number;
  pipelineValue: number;
  weightedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
  winRate: number | null;
}

export interface PipelineReport {
  summary: PipelineBucket & { leadCount: number };
  byStage: (PipelineBucket & { stageId: string; name: string; nameAr?: string | null; sequence: number; probability: number; isWon: boolean })[];
  bySalesperson: (PipelineBucket & { userId: string | null; name: string })[];
  lostReasons: { reason: string; count: number }[];
}

export const crmService = {
  stages: (includeInactive = false) =>
    data<CrmStage[]>(api.get('/crm/stages', { params: clean({ includeInactive: includeInactive ? 'true' : undefined }) })),
  createStage: (body: Record<string, any>) => data<CrmStage>(api.post('/crm/stages', body)),
  updateStage: (id: string, body: Record<string, any>) => data<CrmStage>(api.patch(`/crm/stages/${id}`, body)),
  deleteStage: (id: string) => data(api.delete(`/crm/stages/${id}`)),

  leads: (params: Record<string, string | undefined> = {}) =>
    data<CrmLead[]>(api.get('/crm/leads', { params: clean(params) })),
  lead: (id: string) => data<CrmLead>(api.get(`/crm/leads/${id}`)),
  createLead: (body: Record<string, any>) => data<CrmLead>(api.post('/crm/leads', clean(body))),
  updateLead: (id: string, body: Record<string, any>) => data<CrmLead>(api.patch(`/crm/leads/${id}`, body)),
  deleteLead: (id: string) => data(api.delete(`/crm/leads/${id}`)),
  moveStage: (id: string, stageId: string) => data<CrmLead>(api.post(`/crm/leads/${id}/stage`, { stageId })),
  won: (id: string) => data<CrmLead>(api.post(`/crm/leads/${id}/won`)),
  lost: (id: string, reason: string) => data<CrmLead>(api.post(`/crm/leads/${id}/lost`, { reason })),
  reopen: (id: string) => data<CrmLead>(api.post(`/crm/leads/${id}/reopen`)),
  toOpportunity: (id: string) => data<CrmLead>(api.post(`/crm/leads/${id}/convert-to-opportunity`)),
  toCustomer: (id: string, body: Record<string, any>) => data(api.post(`/crm/leads/${id}/convert-to-customer`, clean(body))),
  quotation: (id: string, body: Record<string, any>) => data(api.post(`/crm/leads/${id}/quotation`, clean(body))),

  activities: (params: Record<string, string | undefined> = {}) =>
    data<CrmActivity[]>(api.get('/crm/activities', { params: clean(params) })),
  myActivities: (state?: ActivityState) => data<CrmActivity[]>(api.get('/crm/activities/my', { params: clean({ state }) })),
  createActivity: (body: Record<string, any>) => data<CrmActivity>(api.post('/crm/activities', clean(body))),
  updateActivity: (id: string, body: Record<string, any>) => data<CrmActivity>(api.patch(`/crm/activities/${id}`, body)),
  doneActivity: (id: string, result?: string) => data<CrmActivity>(api.post(`/crm/activities/${id}/done`, clean({ result }))),
  cancelActivity: (id: string) => data<CrmActivity>(api.post(`/crm/activities/${id}/cancel`)),
  deleteActivity: (id: string) => data(api.delete(`/crm/activities/${id}`)),

  pipelineReport: (params: { from?: string; to?: string; assignedUserId?: string } = {}) =>
    data<PipelineReport>(api.get('/crm/reports/pipeline', { params: clean(params) })),
};
