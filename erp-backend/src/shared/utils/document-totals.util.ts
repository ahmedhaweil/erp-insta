import { BadRequestException } from '@nestjs/common';

/**
 * Server-side computation of document line amounts and totals.
 *
 * Client-supplied totals must never be trusted: every sales, purchase and POS
 * document recomputes its amounts here. `discount` is an absolute amount per
 * line (not a percentage), and `lineTotal` is the untaxed net amount.
 */
export interface LineInput {
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
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

export function computeLine(line: LineInput): ComputedLine {
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

/** Adds `days` to an ISO date (YYYY-MM-DD) and returns an ISO date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
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
