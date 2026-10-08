import { BadRequestException } from '@nestjs/common';
import { round } from '@shared/utils/document-totals.util';
import type { LotAllocation, StockLotInput } from './lots.service';

/**
 * Helpers for lots/serial numbers recorded on documents (sales order lines,
 * POS lines, returns, production runs). Quantities are always in the
 * product's base unit.
 */

const EPS = 0.00005;

/** Lots as stored on a document line (expiry kept for re-receipts). */
export type DocumentLot = LotAllocation;

/** Normalises a stored jsonb value into a lot list. */
export function asLots(value: unknown): DocumentLot[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((l) => l && typeof l.lotNumber === 'string' && Number(l.quantity) > 0)
    .map((l) => ({
      lotNumber: String(l.lotNumber),
      quantity: round(Number(l.quantity), 4),
      expiryDate: l.expiryDate ?? null,
    }));
}

/** Adds lot quantities together (same lot number merged). */
export function addLots(...lists: (DocumentLot[] | StockLotInput[] | null | undefined)[]): DocumentLot[] {
  const merged = new Map<string, DocumentLot>();
  for (const list of lists) {
    for (const l of asLots(list)) {
      const existing = merged.get(l.lotNumber);
      if (existing) {
        existing.quantity = round(existing.quantity + l.quantity, 4);
        existing.expiryDate = existing.expiryDate ?? l.expiryDate ?? null;
      } else {
        merged.set(l.lotNumber, { ...l });
      }
    }
  }
  return [...merged.values()];
}

/** `from` minus `minus`, per lot number; lots that drop to zero are removed. */
export function subtractLots(from: unknown, minus: unknown): DocumentLot[] {
  const result = new Map(asLots(from).map((l) => [l.lotNumber, { ...l }]));
  for (const l of asLots(minus)) {
    const existing = result.get(l.lotNumber);
    if (!existing) continue;
    existing.quantity = round(existing.quantity - l.quantity, 4);
    if (existing.quantity <= EPS) result.delete(l.lotNumber);
  }
  return [...result.values()];
}

export function totalLots(value: unknown): number {
  return round(asLots(value).reduce((s, l) => s + l.quantity, 0), 4);
}

/**
 * Lots to restore when goods come back (refund / sales return) from the lots
 * originally issued and not yet returned (`available`).
 *
 * - Explicit `requested` lots must be among the available ones (a serial
 *   number or lot that was not sold on this document is refused) and keep
 *   the original expiry date.
 * - Otherwise the available lots are taken in their recorded order.
 * - When nothing was recorded (sold before lots were tracked, untracked
 *   product) `undefined` is returned so the stock service falls back to its
 *   automatic lot; the same applies when the record covers only part of the
 *   quantity and no lots are requested.
 */
export function pickReturnLots(
  available: unknown,
  quantity: number,
  requested?: StockLotInput[] | null,
  label = 'line',
): DocumentLot[] | undefined {
  const pool = asLots(available);
  if (requested?.length) {
    const wanted = addLots(requested);
    const total = totalLots(wanted);
    if (Math.abs(total - quantity) > EPS) {
      throw new BadRequestException(
        `Lot quantities of ${label} (${total}) must equal the returned quantity (${quantity})`,
      );
    }
    if (!pool.length) return wanted;
    const byNumber = new Map(pool.map((l) => [l.lotNumber, l]));
    for (const w of wanted) {
      const origin = byNumber.get(w.lotNumber);
      if (!origin) {
        throw new BadRequestException(`Lot/serial ${w.lotNumber} was not issued on the original ${label}`);
      }
      if (w.quantity > origin.quantity + EPS) {
        throw new BadRequestException(
          `Lot/serial ${w.lotNumber}: ${w.quantity} returned but only ${origin.quantity} was issued and not yet returned`,
        );
      }
      w.expiryDate = w.expiryDate ?? origin.expiryDate ?? null;
    }
    return wanted;
  }
  if (!pool.length || totalLots(pool) + EPS < quantity) return undefined;
  const picked: DocumentLot[] = [];
  let remaining = round(quantity, 4);
  for (const l of pool) {
    if (remaining <= EPS) break;
    const take = round(Math.min(l.quantity, remaining), 4);
    picked.push({ lotNumber: l.lotNumber, quantity: take, expiryDate: l.expiryDate ?? null });
    remaining = round(remaining - take, 4);
  }
  return picked;
}

/** Explicit lots of a request, or undefined (FEFO / automatic lot) when none were given. */
export function lotsOrUndefined(lots?: StockLotInput[] | null): StockLotInput[] | undefined {
  return lots && lots.length ? lots : undefined;
}
