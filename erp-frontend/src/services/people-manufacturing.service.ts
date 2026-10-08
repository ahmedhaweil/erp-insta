import api from '@/lib/api';
import { clean } from './people-hr.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const data = <T = any>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export interface ProductRef {
  id: string;
  code: string;
  nameEn?: string | null;
  nameAr?: string | null;
}

export interface BomLine {
  id: string;
  type: 'component' | 'by_product';
  productId: string;
  quantity: number | string;
  scrapPercent: number | string;
  costSharePercent: number | string;
  sequence: number;
  product?: ProductRef;
}

export interface Bom {
  id: string;
  code: string;
  name?: string | null;
  productId: string;
  outputQuantity: number | string;
  version: number;
  isActive: boolean;
  labourCostPerUnit: number | string;
  overheadCostPerUnit: number | string;
  notes?: string | null;
  product?: ProductRef;
  lines: BomLine[];
}

export interface BomInput {
  productId: string;
  name?: string;
  outputQuantity?: number;
  labourCostPerUnit?: number;
  overheadCostPerUnit?: number;
  isActive?: boolean;
  notes?: string;
  components: { productId: string; quantity: number; scrapPercent?: number }[];
  byProducts?: { productId: string; quantity: number; costSharePercent?: number }[];
}

export interface ExplosionNode {
  productId: string;
  quantity: number;
  scrapPercent: number;
  level: number;
  bomId?: string;
  children?: ExplosionNode[];
}

export interface Explosion {
  bomId: string;
  productId: string;
  quantity: number;
  components: { productId: string; quantity: number; level: number }[];
  subAssemblies: { productId: string; quantity: number; level: number }[];
  byProducts: { productId: string; quantity: number; costSharePercent: number }[];
  labourCost: number;
  overheadCost: number;
  tree: ExplosionNode[];
}

export interface CostRollup {
  bomId: string;
  bomCode: string;
  productId: string;
  version: number;
  quantity: number;
  currentAverageCost: number;
  lines: {
    productId: string;
    productCode?: string;
    productName?: string;
    quantity: number;
    unitCost: number;
    cost: number;
    costSource: 'average_cost' | 'sub_bom';
    subBomId?: string;
  }[];
  materialCost: number;
  labourCost: number;
  overheadCost: number;
  byProductCost: number;
  totalCost: number;
  unitCost: number;
}

export type ProductionStatus = 'draft' | 'confirmed' | 'in_progress' | 'done' | 'cancelled';

export interface ProductionOrderLine {
  id: string;
  type: 'component' | 'by_product';
  productId: string;
  plannedQuantity: number | string;
  scrapPercent: number | string;
  costSharePercent: number | string;
  doneQuantity: number | string;
  reservedQuantity: number | string;
  standardUnitCost: number | string;
  actualCost: number | string;
  product?: ProductRef;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  bomId: string;
  productId: string;
  plannedQuantity: number | string;
  producedQuantity: number | string;
  status: ProductionStatus;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  plannedDate?: string | null;
  completedDate?: string | null;
  exploded: boolean;
  labourCostPerUnit: number | string;
  overheadCostPerUnit: number | string;
  standardUnitCost: number | string;
  actualComponentCost: number | string;
  actualLabourCost: number | string;
  actualOverheadCost: number | string;
  scrapCost: number | string;
  notes?: string | null;
  product?: ProductRef;
  lines?: ProductionOrderLine[];
}

export interface Availability {
  productId: string;
  required: number;
  available: number;
  shortage: number;
}

export interface ProductionRun {
  id: string;
  date: string;
  quantity: number | string;
  componentCost: number | string;
  labourCost: number | string;
  overheadCost: number | string;
  byProductCost: number | string;
  unitCost: number | string;
  moves: { productId: string; type: 'component' | 'by_product'; expectedQuantity: number; quantity: number; unitCost: number; cost: number }[];
}

export interface CostBlock {
  material: number;
  labour: number;
  overhead: number;
  total: number;
  byProductCost: number;
  unitCost: number;
}

export interface OrderCostReport {
  orderId: string;
  orderNumber: string;
  status: ProductionStatus;
  plannedQuantity: number;
  producedQuantity: number;
  costBasisQuantity: number;
  standard: CostBlock;
  actual: CostBlock;
  variance: { material: number; total: number };
  scrapCost: number;
  components: {
    productId: string;
    productCode?: string;
    productName?: string;
    standardQuantity: number;
    standardUnitCost: number;
    standardCost: number;
    actualQuantity: number;
    actualUnitCost: number;
    actualCost: number;
    quantityVariance: number;
    usageVariance: number;
    priceVariance: number;
    totalVariance: number;
  }[];
  byProducts: { productId: string; plannedQuantity: number; producedQuantity: number; cost: number }[];
}

export interface ScrapRecord {
  id: string;
  scrapNumber: string;
  productionOrderId?: string | null;
  productId: string;
  warehouseId: string;
  quantity: number | string;
  unitCost: number | string;
  cost: number | string;
  date: string;
  reason?: string | null;
}

export interface RequirementsReport {
  bomId: string;
  productId: string;
  quantity: number;
  warehouseId: string | null;
  exploded: boolean;
  lines: {
    productId: string;
    productCode?: string;
    productName?: string;
    level: number;
    stockable: boolean;
    required: number;
    onHand: number;
    available: number;
    openOrderDemand: number;
    netAvailable: number;
    shortage: number;
    toBuy: number;
    unitCost: number;
    estimatedCost: number;
  }[];
  shortages: unknown[];
  canProduce: boolean;
  estimatedPurchaseCost: number;
  labourCost: number;
  overheadCost: number;
}

export interface ProductionCostRow {
  orderId: string;
  orderNumber: string;
  productId: string;
  productName?: string;
  status: ProductionStatus;
  plannedQuantity: number;
  producedQuantity: number;
  standardUnitCost: number;
  standardCost: number;
  actualCost: number;
  actualUnitCost: number;
  variance: number;
  scrapCost: number;
}

export interface ProductionCostReport {
  rows: ProductionCostRow[];
  totals: { standardCost: number; actualCost: number; variance: number; scrapCost: number };
}

export const mfgService = {
  boms: (params: { productId?: string; active?: boolean } = {}) =>
    data<Bom[]>(api.get('/manufacturing/boms', { params: clean({ ...params, active: params.active ? 'true' : undefined }) })),
  bom: (id: string) => data<Bom>(api.get(`/manufacturing/boms/${id}`)),
  createBom: (body: BomInput) => data<Bom>(api.post('/manufacturing/boms', body)),
  updateBom: (id: string, body: Partial<BomInput>) => data<Bom>(api.patch(`/manufacturing/boms/${id}`, body)),
  activateBom: (id: string) => data<Bom>(api.post(`/manufacturing/boms/${id}/activate`)),
  deactivateBom: (id: string) => data<Bom>(api.post(`/manufacturing/boms/${id}/deactivate`)),
  newBomVersion: (id: string, activate: boolean) =>
    data<Bom>(api.post(`/manufacturing/boms/${id}/new-version`, undefined, { params: { activate: String(activate) } })),
  deleteBom: (id: string) => data(api.delete(`/manufacturing/boms/${id}`)),
  explode: (id: string, quantity?: number, multiLevel = true) =>
    data<Explosion>(api.get(`/manufacturing/boms/${id}/explode`, { params: clean({ quantity, multiLevel: String(multiLevel) }) })),
  bomCost: (id: string, quantity?: number) =>
    data<CostRollup>(api.get(`/manufacturing/boms/${id}/cost`, { params: clean({ quantity }) })),

  orders: (params: { status?: string; productId?: string } = {}) =>
    data<ProductionOrder[]>(api.get('/manufacturing/production-orders', { params: clean(params) })),
  order: (id: string) => data<ProductionOrder>(api.get(`/manufacturing/production-orders/${id}`)),
  createOrder: (body: Record<string, any>) => data<ProductionOrder>(api.post('/manufacturing/production-orders', clean(body))),
  deleteOrder: (id: string) => data(api.delete(`/manufacturing/production-orders/${id}`)),
  availability: (id: string) => data<Availability[]>(api.get(`/manufacturing/production-orders/${id}/availability`)),
  confirmOrder: (id: string, body: { reserve?: boolean; allowShortage?: boolean }) =>
    data<ProductionOrder>(api.post(`/manufacturing/production-orders/${id}/confirm`, body)),
  startOrder: (id: string) => data<ProductionOrder>(api.post(`/manufacturing/production-orders/${id}/start`)),
  produce: (id: string, body: { quantity: number; date?: string; consumption?: { productId: string; quantity: number }[]; finish?: boolean }) =>
    data(api.post(`/manufacturing/production-orders/${id}/produce`, clean(body))),
  finishOrder: (id: string) => data<ProductionOrder>(api.post(`/manufacturing/production-orders/${id}/finish`)),
  cancelOrder: (id: string) => data<ProductionOrder>(api.post(`/manufacturing/production-orders/${id}/cancel`)),
  orderCost: (id: string) => data<OrderCostReport>(api.get(`/manufacturing/production-orders/${id}/cost`)),
  orderRuns: (id: string) => data<ProductionRun[]>(api.get(`/manufacturing/production-orders/${id}/runs`)),

  scraps: (productionOrderId?: string) =>
    data<ScrapRecord[]>(api.get('/manufacturing/scraps', { params: clean({ productionOrderId }) })),
  createScrap: (body: Record<string, any>) => data<ScrapRecord>(api.post('/manufacturing/scraps', clean(body))),

  requirements: (params: { bomId?: string; productId?: string; quantity: number; warehouseId?: string; explode?: boolean }) =>
    data<RequirementsReport>(
      api.get('/manufacturing/reports/requirements', {
        params: clean({ ...params, explode: params.explode === undefined ? undefined : String(params.explode) }),
      }),
    ),
  productionCosts: (params: { from?: string; to?: string } = {}) =>
    data<ProductionCostReport>(api.get('/manufacturing/reports/production-costs', { params: clean(params) })),
};
