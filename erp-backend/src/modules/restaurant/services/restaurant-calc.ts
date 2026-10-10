import { BadRequestException } from '@nestjs/common';
import { computeLine, round } from '@shared/utils/document-totals.util';
import { ComboGroup, ModifierType } from '../entities/menu.entity';
import { KitchenTicketItem, LineModifier, TicketOrderType } from '../entities/ticket.entity';
import { DriverCommissionBasis } from '../entities/master-data.entity';

/**
 * Pure restaurant calculations (prices, totals, kitchen deltas, commissions),
 * kept free of persistence so the rules can be unit tested directly.
 */

const EPS = 0.0001;

// ---------------------------------------------------------------- prices

/** Delivery-app price when the app has one for the product, else the list price. */
export function basePriceFor(listPrice: number, appPrice?: number | null): number {
  return appPrice != null ? round(Number(appPrice), 4) : round(Number(listPrice), 4);
}

/** Base price + addons − withouts, floored at 0. */
export function unitPriceWithModifiers(basePrice: number, modifiers: Pick<LineModifier, 'type' | 'price'>[]): number {
  let price = Number(basePrice);
  for (const m of modifiers) {
    const amount = Number(m.price || 0);
    if (amount < 0) throw new BadRequestException('Modifier price cannot be negative');
    price += m.type === ModifierType.ADDON ? amount : -amount;
  }
  return Math.max(0, round(price, 4));
}

export interface ComboPick {
  groupId: string;
  productId: string;
}

export interface ComboComponent {
  groupId: string;
  productId: string;
  /** Component units per combo unit. */
  unitQty: number;
  extraPrice: number;
}

/**
 * Validates the choices made for a combo against its groups (choice must
 * belong to the group, min/max picks respected) and returns the components.
 */
export function resolveComboPicks(groups: ComboGroup[], picks: ComboPick[]): ComboComponent[] {
  const byGroup = new Map(groups.map((g) => [g.id, g]));
  for (const pick of picks) {
    if (!byGroup.has(pick.groupId)) {
      throw new BadRequestException(`Combo group ${pick.groupId} does not belong to this combo`);
    }
  }
  const components: ComboComponent[] = [];
  for (const group of groups) {
    const chosen = picks.filter((p) => p.groupId === group.id);
    if (chosen.length < group.minPicks || chosen.length > group.maxPicks) {
      throw new BadRequestException(
        `Choose between ${group.minPicks} and ${group.maxPicks} item(s) from "${group.nameEn || group.nameAr}"`,
      );
    }
    for (const pick of chosen) {
      const item = (group.items || []).find((i) => i.productId === pick.productId);
      if (!item) {
        throw new BadRequestException(`Product ${pick.productId} is not a choice of "${group.nameEn || group.nameAr}"`);
      }
      components.push({
        groupId: group.id,
        productId: item.productId,
        unitQty: Number(item.quantity || 1),
        extraPrice: Number(item.extraPrice || 0),
      });
    }
  }
  return components;
}

/** Identical product, modifiers and note merge into one line (combos never merge). */
export function lineMergeKey(productId: string, modifiers: { modifierId: string }[], note?: string | null): string {
  const ids = modifiers.map((m) => m.modifierId).sort().join(',');
  return `${productId}|${ids}|${(note ?? '').trim()}`;
}

// ---------------------------------------------------------------- totals

export interface TotalsLine {
  id: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export interface TotalsInput {
  orderType: TicketOrderType;
  lines: TotalsLine[];
  invoiceDiscount: number;
  serviceChargePercent: number;
  serviceChargeTaxRate: number;
  deliveryFee: number;
  deliveryFeeTaxRate: number;
}

export interface LineAmounts {
  /** Line discount + share of the invoice discount. */
  discount: number;
  lineNet: number;
  tax: number;
}

export interface TicketTotals {
  itemsGross: number;
  lineDiscounts: number;
  invoiceDiscount: number;
  discountTotal: number;
  itemsNet: number;
  serviceChargePercent: number;
  serviceCharge: number;
  serviceChargeTax: number;
  deliveryFee: number;
  deliveryFeeTax: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  lines: Map<string, LineAmounts>;
}

/**
 * Spreads the invoice discount over the lines in proportion to their amount
 * after line discounts; the last line takes the rounding remainder.
 */
export function allocateInvoiceDiscount(
  lines: { id: string; amount: number }[],
  invoiceDiscount: number,
): Map<string, number> {
  const result = new Map<string, number>();
  const discount = round(Number(invoiceDiscount || 0), 4);
  const eligible = lines.filter((l) => l.amount > EPS);
  const base = eligible.reduce((s, l) => s + l.amount, 0);
  if (discount < 0) throw new BadRequestException('Invoice discount cannot be negative');
  if (discount > round(base, 4) + EPS) {
    throw new BadRequestException(`Invoice discount ${discount} exceeds the ticket amount ${round(base, 4)}`);
  }
  let left = discount;
  eligible.forEach((line, i) => {
    const share = i === eligible.length - 1 ? left : round((discount * line.amount) / base, 4);
    const capped = Math.min(share, line.amount);
    result.set(line.id, round(capped, 4));
    left = round(left - capped, 4);
  });
  return result;
}

/**
 * Ticket totals: line discounts and the invoice discount reduce each line
 * before its own tax rate is applied; the service charge (dine-in only) is a
 * percentage of the items after discounts; the delivery fee (delivery only)
 * is taxed at the delivery-fee product rate. Amounts are computed with the
 * same line routine as the POS so the sale recorded at payment matches.
 */
export function computeTicketTotals(input: TotalsInput): TicketTotals {
  const active = input.lines.filter((l) => Number(l.quantity) > EPS);
  const gross = (l: TotalsLine) => round(Number(l.quantity) * Number(l.unitPrice), 4);

  for (const l of active) {
    if (Number(l.discount || 0) > gross(l) + EPS) {
      throw new BadRequestException('Line discount cannot exceed the line amount');
    }
  }
  const shares = allocateInvoiceDiscount(
    active.map((l) => ({ id: l.id, amount: round(gross(l) - Number(l.discount || 0), 4) })),
    input.invoiceDiscount,
  );

  const lines = new Map<string, LineAmounts>();
  let itemsGross = 0;
  let lineDiscounts = 0;
  let itemsNet = 0;
  let itemsTax = 0;
  for (const l of active) {
    const discount = Math.min(
      round(Number(l.discount || 0) + (shares.get(l.id) ?? 0), 4),
      Number(l.quantity) * Number(l.unitPrice),
    );
    const c = computeLine({ quantity: l.quantity, unitPrice: l.unitPrice, discount, taxRate: l.taxRate });
    lines.set(l.id, { discount, lineNet: c.lineTotal, tax: c.taxAmount });
    itemsGross += gross(l);
    lineDiscounts += Number(l.discount || 0);
    itemsNet += c.lineTotal;
    itemsTax += c.taxAmount;
  }
  itemsNet = round(itemsNet, 4);

  const scPercent = input.orderType === TicketOrderType.DINE_IN ? Number(input.serviceChargePercent || 0) : 0;
  const serviceCharge = round((itemsNet * scPercent) / 100, 4);
  const serviceChargeTax =
    serviceCharge > 0
      ? computeLine({ quantity: 1, unitPrice: serviceCharge, taxRate: input.serviceChargeTaxRate }).taxAmount
      : 0;

  const deliveryFee =
    input.orderType === TicketOrderType.DELIVERY ? round(Number(input.deliveryFee || 0), 4) : 0;
  if (deliveryFee < 0) throw new BadRequestException('Delivery fee cannot be negative');
  const deliveryFeeTax =
    deliveryFee > 0
      ? computeLine({ quantity: 1, unitPrice: deliveryFee, taxRate: input.deliveryFeeTaxRate }).taxAmount
      : 0;

  const subtotal = round(itemsNet + serviceCharge + deliveryFee, 4);
  const taxAmount = round(itemsTax + serviceChargeTax + deliveryFeeTax, 4);
  const invoiceDiscount = round(Number(input.invoiceDiscount || 0), 4);
  return {
    itemsGross: round(itemsGross, 4),
    lineDiscounts: round(lineDiscounts, 4),
    invoiceDiscount,
    discountTotal: round(lineDiscounts + invoiceDiscount, 4),
    itemsNet,
    serviceChargePercent: scPercent,
    serviceCharge,
    serviceChargeTax,
    deliveryFee,
    deliveryFeeTax,
    subtotal,
    taxAmount,
    totalAmount: round(subtotal + taxAmount, 4),
    lines,
  };
}

/** Equal split preview: n shares, the last one absorbing the rounding. */
export function equalSplit(total: number, ways: number): number[] {
  if (!Number.isInteger(ways) || ways < 2) throw new BadRequestException('Split into at least 2 parts');
  const share = Math.floor((Number(total) / ways) * 100) / 100;
  const shares = Array.from({ length: ways }, () => share);
  shares[ways - 1] = round(Number(total) - share * (ways - 1), 2);
  return shares;
}

/** Moving `qty` of a line to another ticket: how much of the sent quantity goes with it. */
export function splitSentQty(lineQty: number, sentQty: number, moveQty: number) {
  if (!(moveQty > 0) || moveQty > lineQty + EPS) {
    throw new BadRequestException(`Cannot move ${moveQty} of a line holding ${lineQty}`);
  }
  const movedSent = round(Math.min(moveQty, sentQty), 4);
  return {
    moved: { quantity: round(moveQty, 4), sentQty: movedSent },
    kept: { quantity: round(lineQty - moveQty, 4), sentQty: round(sentQty - movedSent, 4) },
  };
}

// ---------------------------------------------------------------- kitchen

export interface KitchenLine {
  id: string;
  productId: string;
  categoryId?: string | null;
  quantity: number;
  sentQty: number;
  modifiers: LineModifier[];
  note?: string | null;
  nameAr?: string;
  nameEn?: string | null;
  /** Combo container line (its components are routed instead). */
  isComboParent?: boolean;
}

export interface KitchenRouteLike {
  stationId: string;
  productId?: string | null;
  categoryId?: string | null;
}

/** Product routes win over category routes. */
export function stationsFor(productId: string, categoryId: string | null | undefined, routes: KitchenRouteLike[]): string[] {
  const byProduct = routes.filter((r) => r.productId === productId).map((r) => r.stationId);
  if (byProduct.length) return [...new Set(byProduct)];
  if (!categoryId) return [];
  return [...new Set(routes.filter((r) => !r.productId && r.categoryId === categoryId).map((r) => r.stationId))];
}

export interface KitchenDelta {
  /** stationId -> items to prepare (positive) */
  orders: Map<string, KitchenTicketItem[]>;
  /** stationId -> cancellations (negative) */
  cancellations: Map<string, KitchenTicketItem[]>;
  /** Lines whose sent quantity changes, with their new sent quantity. */
  sent: { lineId: string; sentQty: number }[];
}

/**
 * What has to go to the kitchen: per line the difference between the
 * ordered and the already sent quantity, routed to the line's stations.
 * Negative differences are cancellations of items already sent.
 */
export function kitchenDelta(lines: KitchenLine[], routes: KitchenRouteLike[]): KitchenDelta {
  const orders = new Map<string, KitchenTicketItem[]>();
  const cancellations = new Map<string, KitchenTicketItem[]>();
  const sent: { lineId: string; sentQty: number }[] = [];
  const push = (map: Map<string, KitchenTicketItem[]>, station: string, item: KitchenTicketItem) => {
    const list = map.get(station) ?? [];
    list.push(item);
    map.set(station, list);
  };

  for (const line of lines) {
    const delta = round(Number(line.quantity) - Number(line.sentQty || 0), 4);
    if (Math.abs(delta) < EPS) continue;
    sent.push({ lineId: line.id, sentQty: round(Number(line.quantity), 4) });
    if (line.isComboParent) continue;
    const item: KitchenTicketItem = {
      lineId: line.id,
      productId: line.productId,
      nameAr: line.nameAr,
      nameEn: line.nameEn ?? null,
      quantity: delta,
      modifiers: line.modifiers ?? [],
      note: line.note ?? null,
    };
    for (const station of stationsFor(line.productId, line.categoryId, routes)) {
      push(delta > 0 ? orders : cancellations, station, item);
    }
  }
  return { orders, cancellations, sent };
}

export type KdsLevel = 'green' | 'yellow' | 'orange' | 'red';

export function kdsLevel(ageMinutes: number, t: { yellow: number; orange: number; red: number }): KdsLevel {
  if (ageMinutes >= t.red) return 'red';
  if (ageMinutes >= t.orange) return 'orange';
  if (ageMinutes >= t.yellow) return 'yellow';
  return 'green';
}

export function minutesBetween(from: Date, to: Date): number {
  return round((new Date(to).getTime() - new Date(from).getTime()) / 60000, 2);
}

// ---------------------------------------------------------------- commissions

export interface CommissionTicket {
  itemsNet: number;
  serviceCharge: number;
  deliveryFee: number;
  totalAmount: number;
}

/**
 * Driver commission: a percentage of the sales (net of tax, excluding the
 * delivery fee) or of the delivery fees of the tickets delivered.
 */
export function driverCommission(
  driver: { commissionPercent: number; commissionBasis: DriverCommissionBasis },
  tickets: CommissionTicket[],
) {
  const sales = round(tickets.reduce((s, t) => s + Number(t.itemsNet) + Number(t.serviceCharge || 0), 0), 4);
  const deliveryFees = round(tickets.reduce((s, t) => s + Number(t.deliveryFee || 0), 0), 4);
  const totalAmount = round(tickets.reduce((s, t) => s + Number(t.totalAmount), 0), 4);
  const base = driver.commissionBasis === DriverCommissionBasis.SALES ? sales : deliveryFees;
  return {
    tickets: tickets.length,
    sales,
    deliveryFees,
    totalAmount,
    commissionBasis: driver.commissionBasis,
    commissionPercent: Number(driver.commissionPercent),
    commission: round((base * Number(driver.commissionPercent)) / 100, 4),
  };
}
