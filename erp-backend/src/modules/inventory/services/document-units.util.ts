import { BadRequestException } from '@nestjs/common';
import { round } from '@shared/utils/document-totals.util';
import type { ProductsService } from './products.service';

/**
 * Alternate units on document lines (sales, purchasing, POS, returns).
 *
 * A line keeps its quantity and unit price in the unit it was entered in
 * (`unitId`, e.g. carton) together with `unitFactor` (base units per line
 * unit, e.g. 12). Stock moves and costs use the base quantity
 * `quantity x unitFactor`; costs per base unit are multiplied back by the
 * factor where a per-line-unit figure is needed.
 */
export interface UnitLineInput {
  productId: string;
  unitId?: string | null;
  /** Internal carry-over (order -> invoice, invoice -> credit note): reuse the stored factor. */
  unitFactor?: number | null;
}

export interface ResolvedUnit {
  unitId: string | null;
  unitFactor: number;
  /** Sell price of one line unit when the alternate unit defines one. */
  unitSellPrice: number | null;
}

/** Base quantity of a line quantity expressed in a unit with `factor`. */
export function toBaseQty(quantity: number, factor?: number | null): number {
  return round(Number(quantity) * (Number(factor) || 1), 4);
}

/** Quantity in the line unit from a base quantity. */
export function fromBaseQty(baseQuantity: number, factor?: number | null): number {
  return round(Number(baseQuantity) / (Number(factor) || 1), 4);
}

export async function resolveLineUnits<T extends UnitLineInput>(
  products: Pick<ProductsService, 'resolveLineUnit'> | undefined | null,
  tenantId: string,
  lines: T[],
): Promise<(T & ResolvedUnit)[]> {
  const out: (T & ResolvedUnit)[] = [];
  for (const line of lines) {
    if (!line.unitId) {
      out.push({ ...line, unitId: null, unitFactor: 1, unitSellPrice: null });
      continue;
    }
    if (line.unitFactor && Number(line.unitFactor) > 0) {
      out.push({ ...line, unitId: line.unitId, unitFactor: Number(line.unitFactor), unitSellPrice: null });
      continue;
    }
    if (!products) throw new BadRequestException('Alternate units are not available');
    const unit = await products.resolveLineUnit(tenantId, line.productId, line.unitId);
    if (!(unit.factor > 0)) throw new BadRequestException(`Invalid unit factor for product ${line.productId}`);
    out.push({ ...line, unitId: unit.unitId, unitFactor: unit.factor, unitSellPrice: unit.sellPrice });
  }
  return out;
}
