import { BadRequestException } from '@nestjs/common';
import type { PostingLine, SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { round } from '@shared/utils/document-totals.util';

/**
 * Pure fuel-shift arithmetic, kept apart from the service so the rules are
 * unit tested directly.
 */

export interface NozzleReadingInput {
  openingReading: number;
  closingReading: number;
  meterReset?: boolean;
  /** Reading at which the meter rolled over; defaults to the opening reading (meter replaced). */
  rolloverAt?: number | null;
  /** Pump price, VAT included. */
  unitPrice: number;
  taxRate: number;
}

export interface NozzleSales {
  liters: number;
  amount: number;
  netAmount: number;
  taxAmount: number;
}

/**
 * liters = closing - opening; with a meter reset the liters run from the
 * opening reading up to the rollover point, then from zero to the closing
 * reading. amount = liters x pump price (VAT included), split into net + VAT.
 */
export function computeNozzleSales(input: NozzleReadingInput): NozzleSales {
  const opening = Number(input.openingReading);
  const closing = Number(input.closingReading);
  let liters: number;
  if (input.meterReset) {
    const rollover = input.rolloverAt == null ? opening : Number(input.rolloverAt);
    if (rollover < opening) {
      throw new BadRequestException('The rollover reading cannot be below the opening reading');
    }
    liters = rollover - opening + closing;
  } else {
    if (closing < opening - 0.00005) {
      throw new BadRequestException(
        `Closing reading ${closing} is below the opening reading ${opening} (set meterReset if the meter rolled over)`,
      );
    }
    liters = closing - opening;
  }
  liters = round(liters, 4);
  const amount = round(liters * Number(input.unitPrice), 4);
  const netAmount = round(amount / (1 + Number(input.taxRate || 0) / 100), 4);
  return { liters, amount, netAmount, taxAmount: round(amount - netAmount, 4) };
}

/** Margin = net (VAT-exclusive) sales - liters x average cost. */
export function computeMargin(netAmount: number, liters: number, unitCost: number) {
  const cost = round(Number(liters) * Number(unitCost), 4);
  return { cost, margin: round(Number(netAmount) - cost, 4) };
}

export interface ShiftCashInput {
  totalAmount: number;
  couponAmount: number;
  cardAmount: number;
  creditAmount: number;
  /** Defaults to the expected cash. */
  cashCounted?: number | null;
}

/** cash expected = amount - coupons - card - credit; difference = counted - expected. */
export function computeShiftCash(input: ShiftCashInput) {
  const cashExpected = round(
    Number(input.totalAmount) - Number(input.couponAmount) - Number(input.cardAmount) - Number(input.creditAmount),
    4,
  );
  if (cashExpected < -0.0001) {
    throw new BadRequestException(
      `Coupons, card and credit sales (${round(Number(input.totalAmount) - cashExpected, 2)}) exceed the shift sales (${round(Number(input.totalAmount), 2)})`,
    );
  }
  const cashCounted = input.cashCounted == null ? cashExpected : round(Number(input.cashCounted), 4);
  return { cashExpected, cashCounted, cashDifference: round(cashCounted - cashExpected, 4) };
}

export interface ShiftPostingInput {
  cashExpected: number;
  cashCounted: number;
  cardAmount: number;
  couponAmount: number;
  /** Net sales and VAT not already booked by the credit-customer invoices. */
  netSales: number;
  taxAmount: number;
  cost: number;
  /** Post the counted cash and the difference to cash over/short. */
  useOverShort: boolean;
}

/**
 * Shift sales entry:
 *   Dr cash (counted, or expected without an over/short account)
 *   Dr cash over/short (shortage)  |  Cr cash over/short (overage)
 *   Dr bank (cards)   Dr fuel coupons
 *   Cr sales (net)    Cr output VAT
 *   Dr COGS / Cr inventory
 * Credit-customer sales are booked by their own posted sales invoices
 * (Dr receivable / Cr sales / Cr VAT), so they are not repeated here.
 */
export function buildShiftPostingLines(
  p: ShiftPostingInput,
  account: (key: SettingsAccountKey) => string,
): PostingLine[] {
  const lines: PostingLine[] = [];
  if (p.useOverShort) {
    if (p.cashCounted > 0) lines.push({ accountId: account('cashAccountId'), debit: p.cashCounted });
    const diff = round(p.cashCounted - p.cashExpected, 4);
    if (diff < 0) lines.push({ accountId: account('cashOverShortAccountId'), debit: -diff, description: 'Cash shortage' });
    if (diff > 0) lines.push({ accountId: account('cashOverShortAccountId'), credit: diff, description: 'Cash overage' });
  } else if (p.cashExpected > 0) {
    lines.push({ accountId: account('cashAccountId'), debit: p.cashExpected });
  }
  if (p.cardAmount > 0) lines.push({ accountId: account('bankAccountId'), debit: p.cardAmount });
  if (p.couponAmount > 0) lines.push({ accountId: account('fuelCouponAccountId'), debit: p.couponAmount });
  if (p.netSales > 0) lines.push({ accountId: account('salesAccountId'), credit: p.netSales });
  if (p.taxAmount > 0) lines.push({ accountId: account('outputTaxAccountId'), credit: p.taxAmount });
  if (p.cost > 0) {
    lines.push({ accountId: account('cogsAccountId'), debit: p.cost });
    lines.push({ accountId: account('inventoryAccountId'), credit: p.cost });
  }
  return lines;
}

export interface TankMovement {
  quantity: number;
  referenceType: string | null;
  createdAt: Date;
}

/**
 * Tank reconciliation for [from, to]: opening book + receipts - pump sales
 * - other issues = expected level, compared with the last dip of the period.
 * Dip adjustments are shown apart so they do not hide the loss they fixed.
 */
export function reconcileTank(movements: TankMovement[], from: Date, to: Date, lastDipQty: number | null) {
  let opening = 0;
  let receipts = 0;
  let sales = 0;
  let otherIssues = 0;
  let dipAdjustments = 0;
  for (const m of movements) {
    const at = new Date(m.createdAt);
    const qty = Number(m.quantity);
    if (at < from) {
      opening += qty;
      continue;
    }
    if (at > to) continue;
    if (m.referenceType === 'fuel_shift') sales -= qty;
    else if (m.referenceType === 'fuel_tank_dip') dipAdjustments += qty;
    else if (qty > 0) receipts += qty;
    else otherIssues -= qty;
  }
  const expected = round(opening + receipts - sales - otherIssues, 4);
  return {
    openingBook: round(opening, 4),
    receipts: round(receipts, 4),
    sales: round(sales, 4),
    otherIssues: round(otherIssues, 4),
    expected,
    dipAdjustments: round(dipAdjustments, 4),
    closingBook: round(expected + dipAdjustments, 4),
    lastDip: lastDipQty,
    variance: lastDipQty == null ? null : round(lastDipQty - expected, 4),
  };
}
