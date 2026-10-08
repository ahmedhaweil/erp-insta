import api from '@/lib/api';

/** Loose record type used by the operations screens (inventory, sales, purchasing, POS, compliance). */
export type Row = { id: string; [key: string]: any };

type Params = Record<string, string | number | boolean | undefined | null>;

function clean(params?: Params) {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

/** Thin wrappers that unwrap the `{ success, data }` envelope. */
export const ops = {
  get: <T = any>(url: string, params?: Params) =>
    api.get(url, { params: clean(params) }).then((r) => r.data.data as T),
  post: <T = any>(url: string, body?: unknown) => api.post(url, body ?? {}).then((r) => r.data.data as T),
  put: <T = any>(url: string, body?: unknown) => api.put(url, body ?? {}).then((r) => r.data.data as T),
  patch: <T = any>(url: string, body?: unknown) => api.patch(url, body ?? {}).then((r) => r.data.data as T),
  del: <T = any>(url: string) => api.delete(url).then((r) => r.data.data as T),
};

/** Extracts a readable error message from an axios error. */
export function apiError(err: any, fallback: string): string {
  const data = err?.response?.data;
  const details = data?.error?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((d: any) => (typeof d === 'string' ? d : d?.message)).filter(Boolean).join(' - ');
  }
  const msg = data?.error?.message ?? data?.message;
  if (Array.isArray(msg)) return msg.join(' - ');
  if (typeof msg === 'string' && msg) return msg;
  return fallback;
}
