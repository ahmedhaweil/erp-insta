import { BadRequestException } from '@nestjs/common';

/**
 * Server-side computation of document line amounts and totals.
 *
 * Client-supplied totals must never be trusted: every sales, purchase and POS
 * document recomputes its amounts here. `discount` is an absolute amount per
 * line (not a percentage), and `lineTotal` is the untaxed net amount.
 *
 * Tax-inclusive pricing (`taxIncluded`): the unit price and discount are
 * gross amounts that already contain VAT. The untaxed `lineTotal` is then
 * extracted as gross / (1 + rate) and the tax is the remainder, so that
 * lineTotal + taxAmount always equals the gross amount the customer sees.
 */
export interface LineInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
}

export interface LineOptions {
  /** Unit price and discount include VAT (document flag `pricesIncludeTax`). */
  taxIncluded?: boolean;
}

export interface ComputedLine {
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
}

export interface DocumentTotals {
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
}

export function round(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

export function computeLine(line: LineInput, options: LineOptions = {}): ComputedLine {
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  const discount = Number(line.discount || 0);
  const taxRate = Number(line.taxRate || 0);

  if (!(quantity > 0)) throw new BadRequestException('Line quantity must be greater than zero');
  if (unitPrice < 0) throw new BadRequestException('Line unit price cannot be negative');
  if (discount < 0) throw new BadRequestException('Line discount cannot be negative');
  if (taxRate < 0 || taxRate > 100)
    throw new BadRequestException('Line tax rate must be between 0 and 100');

  const gross = quantity * unitPrice;
  if (discount > gross)
    throw new BadRequestException('Line discount cannot exceed the line amount');

  if (options.taxIncluded) {
    const grossTotal = round(gross - discount, 4);
    const lineTotal = round(grossTotal / (1 + taxRate / 100), 4);
    const taxAmount = round(grossTotal - lineTotal, 4);
    return { quantity, unitPrice, discount, taxRate, lineTotal, taxAmount };
  }

  const lineTotal = round(gross - discount, 4);
  const taxAmount = round(lineTotal * (taxRate / 100), 4);
  return { quantity, unitPrice, discount, taxRate, lineTotal, taxAmount };
}

export function computeTotals(lines: ComputedLine[]): DocumentTotals {
  const subtotal = round(
    lines.reduce((sum, l) => sum + l.lineTotal, 0),
    4,
  );
  const taxAmount = round(
    lines.reduce((sum, l) => sum + l.taxAmount, 0),
    4,
  );
  return { subtotal, taxAmount, totalAmount: round(subtotal + taxAmount, 4) };
}

/**
 * Withholding tax (Egypt "الخصم والإضافة", KSA WHT) on the untaxed amount of
 * each line. A line rate overrides the document rate. The result reduces
 * the net amount the customer pays / we pay the vendor at payment time; it
 * does not change the document total (receivable / payable).
 */
export function computeWithholding(
  lines: { lineTotal: number; withholdingRate?: number | null }[],
  documentRate?: number | null,
): number {
  const docRate = Number(documentRate || 0);
  let amount = 0;
  for (const line of lines) {
    const rate =
      line.withholdingRate !== undefined && line.withholdingRate !== null
        ? Number(line.withholdingRate)
        : docRate;
    if (rate < 0 || rate > 100) {
      throw new BadRequestException('Withholding rate must be between 0 and 100');
    }
    amount += Number(line.lineTotal) * (rate / 100);
  }
  return round(amount, 4);
}

/** Adds `days` to an ISO date (YYYY-MM-DD) and returns an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().split('T')[0];
}

/**
 * Adds `months` to an ISO date, clamping to the last day of the target month
 * (2026-01-31 + 1 month = 2026-02-28).
 */
export function addMonths(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().split('T')[0];
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export type PaymentState = 'not_paid' | 'partial' | 'paid';

/** Odoo-style payment state derived from the paid and total amounts. */
export function paymentState(paidAmount: number, totalAmount: number): PaymentState {
  const paid = round(Number(paidAmount), 4);
  const total = round(Number(totalAmount), 4);
  if (paid <= 0) return 'not_paid';
  return paid >= total ? 'paid' : 'partial';
}

export function residual(totalAmount: number, paidAmount: number): number {
  return Math.max(round(Number(totalAmount) - Number(paidAmount), 4), 0);
}
