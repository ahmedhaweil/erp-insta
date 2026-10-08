import api from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
const data = <T = any>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export interface NamedRef {
  id: string;
  code?: string;
  name?: string;
  nameEn?: string | null;
  nameAr?: string | null;
  email?: string;
}

/** Master data owned by other areas, read-only here to fill the dropdowns. */
export const lookupsService = {
  branches: () => data<NamedRef[]>(api.get('/branches')),
  users: () => data<NamedRef[]>(api.get('/users')),
  products: () => data<NamedRef[]>(api.get('/inventory/products')),
  warehouses: () => data<NamedRef[]>(api.get('/inventory/warehouses')),
  customers: () => data<NamedRef[]>(api.get('/sales/customers')),
};
