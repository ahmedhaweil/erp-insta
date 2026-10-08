export interface CartLine {
  productId: string;
  name: string;
  code: string;
  quantity: number;
  /** Unit price per base unit. */
  unitPrice: number;
  /** List price per base unit, used to show the discount. */
  listPrice: number;
  discountPct: number;
  taxRate: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function lineAmounts(l: CartLine) {
  const gross = l.quantity * l.unitPrice;
  const discount = r2((gross * l.discountPct) / 100);
  const net = gross - discount;
  const tax = (net * l.taxRate) / 100;
  return { gross, discount, net, tax, total: net + tax };
}

export function cartTotals(lines: CartLine[]) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    subtotal += a.net;
    discount += a.discount;
    tax += a.tax;
  }
  return { subtotal: r2(subtotal), discount: r2(discount), tax: r2(tax), total: r2(subtotal + tax) };
}

/** Effective discount of a line versus the list price (what the terminal limit checks). */
export function effectiveDiscountPct(l: CartLine): number {
  const list = l.listPrice * l.quantity;
  if (list <= 0) return 0;
  const charged = lineAmounts(l).net;
  return ((list - charged) / list) * 100;
}
