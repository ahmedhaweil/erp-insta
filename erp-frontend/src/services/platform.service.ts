import api from '@/lib/api';

/**
 * Cross-cutting services: printing (PDF), file downloads, approvals, data
 * import / export, alert rules and the current user's notifications.
 */

const d = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

type Params = Record<string, string | number | boolean | undefined | null>;

function clean(params?: Params) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/**
 * Error bodies of blob requests arrive as a Blob; turn them back into JSON so
 * the usual `err.response.data.error.message` handling works.
 */
async function unblobError(err: any): Promise<never> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      err.response.data = JSON.parse(await data.text());
    } catch {
      /* keep the blob */
    }
  }
  throw err;
}

function filenameOf(headers: Record<string, any>, fallback: string) {
  const disposition: string = headers['content-disposition'] || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : fallback;
}

/** GETs a binary file with the auth header. */
export async function fetchBlob(url: string, params?: Params): Promise<{ blob: Blob; filename: string }> {
  try {
    const res = await api.get(url, { params: clean(params), responseType: 'blob' });
    return { blob: res.data as Blob, filename: filenameOf(res.headers as any, url.split('/').pop() || 'file') };
  } catch (err) {
    return unblobError(err);
  }
}

/** Downloads a file (Excel, CSV...) through a temporary link. */
export async function downloadFile(url: string, params?: Params, fallbackName?: string) {
  const { blob, filename } = await fetchBlob(url, params);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fallbackName && !filename.includes('.') ? fallbackName : filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5000);
}

/**
 * Opens a server PDF in a new tab. The tab is opened synchronously (inside the
 * click) so popup blockers allow it, then pointed at a blob URL of the PDF
 * fetched with the Authorization header.
 */
export async function openPdf(url: string, params?: Params) {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const { blob, filename } = await fetchBlob(url, params);
    const pdf = blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
    const href = URL.createObjectURL(pdf);
    if (win) {
      win.location.href = href;
    } else {
      const a = document.createElement('a');
      a.href = href;
      a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

// ------------------------------------------------------------------ approvals

export type ApprovalDocumentType =
  | 'purchase_order'
  | 'vendor_bill'
  | 'payment'
  | 'treasury_voucher'
  | 'sales_discount'
  | 'sales_order'
  | 'journal_entry'
  | 'other';

export const APPROVAL_DOCUMENT_TYPES: ApprovalDocumentType[] = [
  'purchase_order',
  'vendor_bill',
  'payment',
  'treasury_voucher',
  'sales_discount',
  'sales_order',
  'journal_entry',
  'other',
];

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalLevel {
  id?: string;
  sequence?: number;
  name?: string | null;
  roleId?: string | null;
  userIds?: string[];
  minApprovers?: number;
}

export interface ApprovalRule {
  id: string;
  name: string;
  documentType: ApprovalDocumentType;
  minAmount: number | string;
  maxAmount: number | string | null;
  priority: number;
  allowSelfApproval: boolean;
  isActive: boolean;
  description: string | null;
  levels: ApprovalLevel[];
}

export interface ApprovalAction {
  id: string;
  level: number | null;
  userId: string;
  action: 'submit' | 'approve' | 'reject' | 'cancel' | 'comment';
  comment: string | null;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  requestNumber: string;
  ruleId: string;
  documentType: ApprovalDocumentType;
  documentId: string | null;
  documentRef: string | null;
  amount: number | string;
  description: string | null;
  status: ApprovalStatus;
  levels: ApprovalLevel[];
  currentLevel: number;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  actions?: ApprovalAction[];
}

export const approvalsService = {
  rules: (documentType?: string) => d<ApprovalRule[]>(api.get('/approvals/rules', { params: clean({ documentType }) })),
  createRule: (body: Record<string, unknown>) => d<ApprovalRule>(api.post('/approvals/rules', body)),
  updateRule: (id: string, body: Record<string, unknown>) => d<ApprovalRule>(api.patch(`/approvals/rules/${id}`, body)),
  deactivateRule: (id: string) => d<unknown>(api.delete(`/approvals/rules/${id}`)),
  requests: (params: { documentType?: string; status?: string; requestedBy?: string } = {}) =>
    d<ApprovalRequest[]>(api.get('/approvals/requests', { params: clean(params) })),
  myPending: () => d<ApprovalRequest[]>(api.get('/approvals/requests/mine/pending')),
  request: (id: string) => d<ApprovalRequest>(api.get(`/approvals/requests/${id}`)),
  approve: (id: string, comment?: string) => d<ApprovalRequest>(api.post(`/approvals/requests/${id}/approve`, clean({ comment }))),
  reject: (id: string, comment?: string) => d<ApprovalRequest>(api.post(`/approvals/requests/${id}/reject`, clean({ comment }))),
  cancel: (id: string, comment?: string) => d<ApprovalRequest>(api.post(`/approvals/requests/${id}/cancel`, clean({ comment }))),
  comment: (id: string, comment: string) => d<ApprovalRequest>(api.post(`/approvals/requests/${id}/comment`, { comment })),
};

// ---------------------------------------------------------------- data import

export type ImportEntity =
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'accounts'
  | 'employees'
  | 'opening_stock'
  | 'opening_customer_balances'
  | 'opening_supplier_balances';

export interface ImportColumn {
  key: string;
  label: { en: string; ar: string };
  header: string;
  type: string;
  required: boolean;
  values?: string[];
  note?: { en: string; ar: string } | string;
}

export interface ImportCatalogEntry {
  entity: ImportEntity;
  title: { en: string; ar: string };
  exportable: boolean;
  columns: ImportColumn[];
}

export interface ImportIssue {
  row: number;
  column?: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ImportJob {
  id: string;
  entity: ImportEntity;
  status: 'validated' | 'invalid' | 'committed' | 'failed';
  fileName: string;
  options: Record<string, unknown>;
  totalRows: number;
  errorRows: number;
  warningRows: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  issues: ImportIssue[];
  result: Record<string, unknown> | null;
  createdAt: string;
  committedAt: string | null;
}

export interface ImportReport {
  job: ImportJob;
  summary?: Record<string, unknown>;
}

export interface ImportOptions {
  updateExisting?: boolean;
  createMissing?: boolean;
  date?: string;
  offsetAccountId?: string;
}

export const dataImportService = {
  catalog: () => d<ImportCatalogEntry[]>(api.get('/data-import/entities')),
  downloadTemplate: (entity: ImportEntity, lang: string) =>
    downloadFile(`/data-import/templates/${entity}`, { lang }, `${entity}-template.xlsx`),
  validate: (entity: ImportEntity, file: File, options: ImportOptions) => {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of Object.entries(options)) {
      if (v !== undefined && v !== null && v !== '') form.append(k, String(v));
    }
    return d<ImportReport>(api.post(`/data-import/${entity}/validate`, form, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  commit: (jobId: string) => d<ImportReport>(api.post(`/data-import/jobs/${jobId}/commit`)),
  jobs: (params: { entity?: string; status?: string; limit?: number } = {}) =>
    d<ImportJob[]>(api.get('/data-import/jobs', { params: clean(params) })),
  job: (id: string) => d<ImportJob>(api.get(`/data-import/jobs/${id}`)),
  downloadErrors: (jobId: string, lang: string) => downloadFile(`/data-import/jobs/${jobId}/errors`, { lang }, 'errors.xlsx'),
  exportData: (entity: ImportEntity, lang: string) => downloadFile(`/data-import/export/${entity}`, { lang }, `${entity}.xlsx`),
};

// --------------------------------------------------------------------- alerts

type Bilingual = { en: string; ar: string };

export interface AlertTypeDef {
  type: string;
  title: Bilingual;
  description: Bilingual;
  days: { default: number; meaning: Bilingual } | null;
  hours: { default: number; meaning: Bilingual } | null;
  severity: 'info' | 'warning' | 'error' | 'success';
  link: string;
  params?: string[];
}

export interface AlertRule {
  id: string;
  type: string;
  name: string | null;
  isActive: boolean;
  thresholdDays: number | null;
  thresholdHours: number | null;
  params: Record<string, unknown> | null;
  recipientUserIds: string[];
  recipientRoleIds: string[];
  severity: AlertTypeDef['severity'] | null;
  lastRunAt: string | null;
  lastMatchCount: number;
}

export interface AlertScanResult {
  ruleId: string;
  type: string;
  name: string | null;
  matches: number;
  newRecords: number;
  notifiedUsers: number;
  items?: { recordKey: string; label: string; data?: Record<string, unknown> }[];
}

export interface AlertDelivery {
  id: string;
  ruleId: string;
  alertType: string;
  recordKey: string;
  userId: string;
  alertDate: string;
  notificationId: string | null;
  createdAt: string;
}

export const alertsService = {
  types: () => d<AlertTypeDef[]>(api.get('/alerts/types')),
  rules: () => d<AlertRule[]>(api.get('/alerts/rules')),
  createRule: (body: Record<string, unknown>) => d<AlertRule>(api.post('/alerts/rules', body)),
  createDefaults: () => d<AlertRule[]>(api.post('/alerts/rules/defaults')),
  updateRule: (id: string, body: Record<string, unknown>) => d<AlertRule>(api.patch(`/alerts/rules/${id}`, body)),
  deleteRule: (id: string) => d<unknown>(api.delete(`/alerts/rules/${id}`)),
  scan: (body: { ruleId?: string; dryRun?: boolean }) => d<AlertScanResult[]>(api.post('/alerts/scan', body)),
  deliveries: (params: { ruleId?: string; from?: string; limit?: number } = {}) =>
    d<AlertDelivery[]>(api.get('/alerts/deliveries', { params: clean(params) })),
};

// -------------------------------------------------------------- notifications

export interface MyNotification {
  id: string;
  title: string;
  body: string | null;
  type: 'info' | 'warning' | 'error' | 'success';
  isRead: boolean;
  createdAt: string;
  data: Record<string, any> | null;
}

export const myNotificationsService = {
  list: () => d<MyNotification[]>(api.get('/notifications/my')),
  unreadCount: () => d<{ count: number }>(api.get('/notifications/my/unread-count')).then((r) => r.count),
  markRead: (id: string) => d<unknown>(api.patch(`/notifications/${id}/read`)),
  markAllRead: () => d<unknown>(api.patch('/notifications/read-all')),
};

// ------------------------------------------------------------------- lookups

export const platformLookups = {
  users: () => d<{ id: string; name: string; email: string; isActive: boolean }[]>(api.get('/users')),
  roles: () => d<{ id: string; name: string }[]>(api.get('/roles')),
  warehouses: () => d<{ id: string; code: string; nameAr: string; nameEn: string | null }[]>(api.get('/inventory/warehouses')),
};
