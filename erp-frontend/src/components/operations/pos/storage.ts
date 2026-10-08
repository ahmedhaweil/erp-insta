import type { PosOrderInput } from '@/services/operations-pos.service';

/**
 * Browser persistence for the POS till: the open session, the offline sale
 * queue and a product cache. Every access is guarded (private mode, quota).
 */
const SESSION_KEY = 'ops.pos.session';
const QUEUE_KEY = 'ops.pos.queue';
const PRODUCTS_KEY = 'ops.pos.products';

export interface StoredSession {
  id: string;
  terminalId: string;
  terminalName: string;
  openedAt: string;
  openingCash: number;
}

export interface QueuedSale {
  clientReference: string;
  payload: PosOrderInput;
  total: number;
  createdAt: string;
  attempts: number;
  /** Set when the server rejected the sale (not a network problem). */
  lastError?: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: the till keeps working in memory
  }
}

export const posStorage = {
  getSession: () => read<StoredSession | null>(SESSION_KEY, null),
  setSession: (s: StoredSession | null) => write(SESSION_KEY, s),
  getQueue: () => read<QueuedSale[]>(QUEUE_KEY, []),
  setQueue: (q: QueuedSale[]) => write(QUEUE_KEY, q),
  getProducts: () => read<any[]>(PRODUCTS_KEY, []),
  setProducts: (p: any[]) => write(PRODUCTS_KEY, p),
};

/** True when an axios error means "server not reachable" (so the sale can be retried later). */
export function isNetworkError(err: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return !!err && !err.response && (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.message === 'Network Error' || !!err.request);
}

export function newClientReference(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback for non-secure contexts (plain http on a LAN till)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
