import { BadRequestException } from '@nestjs/common';
import { Customer } from '../entities/customer.entity';
import { SalesPricingService } from './sales-pricing.service';
import type { ProductsService } from '@modules/inventory/services/products.service';
import {
  ResolvedUnit,
  UnitLineInput,
  resolveLineUnits,
  toBaseQty,
} from '@modules/inventory/services/document-units.util';
import { round, withDefaultTaxRates } from '@shared/utils/document-totals.util';

export interface SalesLineInput extends UnitLineInput {
  productId: string;
  quantity: number;
  unitPrice?: number | null;
  taxRate?: number | null;
}

/**
 * Resolves the unit of each sales line, prices the lines sent without a
 * price and fills default tax rates.
 *
 * Lines in an alternate unit are priced from the price list on their base
 * quantity and multiplied by the unit factor; when no price list applies and
 * the alternate unit has its own sell price, that price is used.
 */
export async function prepareSalesLines<T extends SalesLineInput>(
  pricing: SalesPricingService | undefined,
  products: Pick<ProductsService, 'resolveLineUnit'> | undefined,
  tenantId: string,
  context: { customer: Customer; priceListId?: string | null; date: string },
  input: T[],
): Promise<{ lines: (T & ResolvedUnit & { unitPrice: number })[]; priceListId: string | null }> {
  let lines = await resolveLineUnits(products, tenantId, input);
  let priceListId: string | null = context.priceListId ?? null;
  const missing = (l: { unitPrice?: number | null }) => l.unitPrice === undefined || l.unitPrice === null;

  if (pricing && lines.some(missing)) {
    const priced = await pricing.priceLines(
      tenantId,
      { customer: context.customer, priceListId: context.priceListId, date: context.date },
      lines.map((l) => ({
        productId: l.productId,
        quantity: toBaseQty(l.quantity, l.unitFactor),
        unitPrice: l.unitPrice ?? undefined,
      })),
    );
    priceListId = priced.priceListId;
    lines = lines.map((l, i) => {
      if (!missing(l)) return l;
      const basePrice = Number(priced.lines[i].unitPrice);
      const unitPrice =
        l.unitFactor === 1
          ? basePrice
          : l.unitSellPrice !== null && !priceListId
            ? l.unitSellPrice
            : round(basePrice * l.unitFactor, 4);
      return { ...l, unitPrice };
    });
  }
  if (lines.some(missing)) throw new BadRequestException('Every line needs a unit price');

  const untaxed = lines.filter((l) => l.taxRate === undefined || l.taxRate === null);
  if (pricing && untaxed.length) {
    lines = withDefaultTaxRates(lines, await pricing.defaultTaxRates(tenantId, untaxed.map((l) => l.productId)));
  }
  return { lines: lines as (T & ResolvedUnit & { unitPrice: number })[], priceListId };
}

/** Lines for the minimum-price check: quantities in base units so prices compare per base unit. */
export function baseUnitLines<T extends { quantity: number; unitFactor?: number | null }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, quantity: toBaseQty(l.quantity, l.unitFactor) }));
}
