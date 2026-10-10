/**
 * Promotions engine (Instasoft disc_item / disc_pouns / disc_fat), as pure
 * functions so the rules can be unit tested without a database.
 *
 * Order of evaluation for one document:
 *   1. Item campaigns: per line, on the amount after the manual line
 *      discount; when several campaigns match a line, the biggest discount wins.
 *   2. Bonus (buy X get Y): per product, the highest tier reached gives its
 *      free quantity (multiplied per multiple of minQty when `repeat`).
 *   3. Invoice discount: on the subtotal after line and offer discounts. A
 *      manual invoice discount always wins; otherwise the matching rule with
 *      the lowest priority number (then the oldest) applies.
 *
 * Amounts are in document price terms (VAT-inclusive when the document uses
 * tax-inclusive prices), so tax is always computed after every discount.
 */

export type PromotionChannel = 'sales' | 'pos';
export type PromotionAppliesTo = 'sales' | 'pos' | 'both';
export type PaymentCondition = 'cash' | 'credit';
export type PaymentConditionRule = 'any' | 'cash' | 'credit';
export type DiscountType = 'percent' | 'amount';
export type PromotionRuleType = 'campaign' | 'bonus' | 'invoice_discount';

export interface PromotionContext {
  channel: PromotionChannel;
  /** Document date, YYYY-MM-DD. */
  date: string;
  /** Local time HH:mm; rules with an hour window only apply when it is known. */
  time?: string | null;
  branchId?: string | null;
  paymentCondition: PaymentCondition;
  /** Manual invoice discount (absolute amount). When > 0, no automatic invoice discount applies. */
  manualInvoiceDiscount?: number | null;
}

/** Conditions shared by every rule type. */
export interface RuleConditions {
  id: string;
  isActive: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  appliesTo: PromotionAppliesTo;
  /** Empty / null = every branch. */
  branchIds?: string[] | null;
  /** 0 = Sunday ... 6 = Saturday. Empty / null = every day. */
  weekdays?: number[] | null;
  /** HH:mm; window [start, end). start > end wraps past midnight. */
  startTime?: string | null;
  endTime?: string | null;
}

export interface CampaignRuleInput extends RuleConditions {
  productIds?: string[] | null;
  /** Matches products in these categories or any of their sub-categories. */
  categoryIds?: string[] | null;
  discountType: DiscountType;
  /** Percent (0-100) or fixed amount per unit. */
  value: number;
}

export interface BonusTier {
  minQty: number;
  freeQty: number;
}

export interface BonusRuleInput extends RuleConditions {
  productId: string;
  /** Only lines sold in this unit count (lines without a unit are in the product base unit). */
  unitId?: string | null;
  /** Product given free; defaults to the purchased product. */
  freeProductId?: string | null;
  tiers: BonusTier[];
  /** Free quantity per multiple of the tier's minQty (Instasoft: no). */
  repeat: boolean;
}

export interface InvoiceDiscountRuleInput extends RuleConditions {
  discountType: DiscountType;
  value: number;
  /** Inclusive subtotal band; maxSubtotal null = no upper bound. */
  minSubtotal: number;
  maxSubtotal?: number | null;
  paymentCondition: PaymentConditionRule;
  priority: number;
  createdAt?: Date | string | null;
}

export interface PromotionRuleSet {
  campaigns: CampaignRuleInput[];
  bonuses: BonusRuleInput[];
  invoiceDiscounts: InvoiceDiscountRuleInput[];
}

export interface PromotionLineInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Manual line discount (absolute amount). */
  discount?: number | null;
  unitId?: string | null;
  /** The product category followed by its ancestors. */
  categoryChain?: string[];
}

export interface EvaluatedLine {
  index: number;
  productId: string;
  quantity: number;
  unitPrice: number;
  gross: number;
  manualDiscount: number;
  offerDiscount: number;
  campaignId: string | null;
  /** Amount after manual and offer discounts. */
  net: number;
}

export interface BonusResult {
  ruleId: string;
  /** Purchased product the bonus is earned on. */
  sourceProductId: string;
  /** Product given free. */
  productId: string;
  purchasedQty: number;
  freeQty: number;
  /** Unit price of the purchased product on the document (value of the free goods). */
  unitPrice: number;
}

export interface InvoiceDiscountResult {
  amount: number;
  ruleId: string | null;
  manual: boolean;
}

export interface PromotionEvaluation {
  lines: EvaluatedLine[];
  bonuses: BonusResult[];
  gross: number;
  /** After line and offer discounts, before the invoice discount and tax. */
  subtotal: number;
  invoiceDiscount: InvoiceDiscountResult;
  appliedRuleIds: string[];
  /** Offer discounts + automatic invoice discount (excludes bonus goods). */
  promotionDiscount: number;
}

export const round4 = (value: number): number =>
  Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map((x) => Number(x));
  return (h || 0) * 60 + (m || 0);
};

/** 0 = Sunday ... 6 = Saturday, from an ISO date. */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

export function isWithinTimeWindow(
  time: string,
  start?: string | null,
  end?: string | null,
): boolean {
  if (!start && !end) return true;
  const t = toMinutes(time);
  const s = start ? toMinutes(start) : 0;
  const e = end ? toMinutes(end) : 24 * 60;
  return s <= e ? t >= s && t < e : t >= s || t < e;
}

/** Whether the shared conditions of a rule hold for the document context. */
export function ruleApplies(rule: RuleConditions, ctx: PromotionContext): boolean {
  if (!rule.isActive) return false;
  if (rule.appliesTo !== 'both' && rule.appliesTo !== ctx.channel) return false;
  if (rule.validFrom && rule.validFrom.slice(0, 10) > ctx.date) return false;
  if (rule.validTo && rule.validTo.slice(0, 10) < ctx.date) return false;
  if (rule.branchIds && rule.branchIds.length > 0) {
    if (!ctx.branchId || !rule.branchIds.includes(ctx.branchId)) return false;
  }
  if (rule.weekdays && rule.weekdays.length > 0) {
    if (!rule.weekdays.map(Number).includes(weekdayOf(ctx.date))) return false;
  }
  if (rule.startTime || rule.endTime) {
    if (!ctx.time) return false;
    if (!isWithinTimeWindow(ctx.time, rule.startTime, rule.endTime)) return false;
  }
  return true;
}

export function campaignMatchesLine(rule: CampaignRuleInput, line: PromotionLineInput): boolean {
  const products = rule.productIds ?? [];
  const categories = rule.categoryIds ?? [];
  if (products.length === 0 && categories.length === 0) return false;
  if (products.includes(line.productId)) return true;
  const chain = line.categoryChain ?? [];
  return categories.some((c) => chain.includes(c));
}

/** Discount a campaign gives on a line whose amount after the manual discount is `net`. */
export function campaignDiscount(rule: CampaignRuleInput, quantity: number, net: number): number {
  if (net <= 0) return 0;
  const value = Number(rule.value);
  const amount =
    rule.discountType === 'amount' ? value * Number(quantity) : (net * value) / 100;
  return round4(Math.min(Math.max(amount, 0), net));
}

/** Free quantity a bonus rule gives for a purchased quantity (0 when no tier is reached). */
export function bonusFreeQty(rule: BonusRuleInput, purchasedQty: number): number {
  const tiers = [...(rule.tiers ?? [])]
    .filter((t) => Number(t.minQty) > 0 && Number(t.freeQty) > 0)
    .sort((a, b) => Number(b.minQty) - Number(a.minQty));
  const tier = tiers.find((t) => purchasedQty + 0.0001 >= Number(t.minQty));
  if (!tier) return 0;
  if (!rule.repeat) return Number(tier.freeQty);
  return Math.floor((purchasedQty + 0.0001) / Number(tier.minQty)) * Number(tier.freeQty);
}

export function invoiceDiscountAmount(rule: InvoiceDiscountRuleInput, subtotal: number): number {
  if (subtotal <= 0) return 0;
  const value = Number(rule.value);
  const amount = rule.discountType === 'amount' ? value : (subtotal * value) / 100;
  return round4(Math.min(Math.max(amount, 0), subtotal));
}

export function invoiceRuleMatches(
  rule: InvoiceDiscountRuleInput,
  ctx: PromotionContext,
  subtotal: number,
): boolean {
  if (!ruleApplies(rule, ctx)) return false;
  if (rule.paymentCondition !== 'any' && rule.paymentCondition !== ctx.paymentCondition) return false;
  if (subtotal + 0.0001 < Number(rule.minSubtotal || 0)) return false;
  if (rule.maxSubtotal !== null && rule.maxSubtotal !== undefined) {
    if (subtotal - 0.0001 > Number(rule.maxSubtotal)) return false;
  }
  return true;
}

const timeOf = (d?: Date | string | null) => (d ? new Date(d).getTime() : 0);

export function evaluatePromotions(
  context: PromotionContext,
  lines: PromotionLineInput[],
  rules: PromotionRuleSet,
): PromotionEvaluation {
  const applied = new Set<string>();
  const campaigns = rules.campaigns.filter((r) => ruleApplies(r, context));

  // 1. Item campaigns: biggest discount wins, after the manual line discount
  const evaluated: EvaluatedLine[] = lines.map((line, index) => {
    const quantity = Number(line.quantity);
    const unitPrice = Number(line.unitPrice);
    const gross = round4(quantity * unitPrice);
    const manualDiscount = round4(Number(line.discount || 0));
    const afterManual = round4(gross - manualDiscount);
    let best = 0;
    let campaignId: string | null = null;
    for (const rule of campaigns) {
      if (!campaignMatchesLine(rule, line)) continue;
      const amount = campaignDiscount(rule, quantity, afterManual);
      if (amount > best + 0.00001) {
        best = amount;
        campaignId = rule.id;
      }
    }
    if (campaignId) applied.add(campaignId);
    return {
      index,
      productId: line.productId,
      quantity,
      unitPrice,
      gross,
      manualDiscount,
      offerDiscount: best,
      campaignId,
      net: round4(afterManual - best),
    };
  });

  // 2. Bonus: per product, the rule giving the most free units
  const bonuses: BonusResult[] = [];
  const bonusRules = rules.bonuses.filter((r) => ruleApplies(r, context));
  const byProduct = new Map<string, BonusRuleInput[]>();
  for (const rule of bonusRules) {
    byProduct.set(rule.productId, [...(byProduct.get(rule.productId) ?? []), rule]);
  }
  for (const [productId, candidates] of byProduct) {
    let best: BonusResult | null = null;
    for (const rule of candidates) {
      const matching = lines.filter(
        (l) =>
          l.productId === productId &&
          Number(l.unitPrice) > 0 &&
          (!rule.unitId || (l.unitId ?? null) === rule.unitId),
      );
      if (matching.length === 0) continue;
      const purchasedQty = round4(matching.reduce((s, l) => s + Number(l.quantity), 0));
      const freeQty = bonusFreeQty(rule, purchasedQty);
      if (freeQty > 0 && (!best || freeQty > best.freeQty)) {
        best = {
          ruleId: rule.id,
          sourceProductId: productId,
          productId: rule.freeProductId || productId,
          purchasedQty,
          freeQty,
          unitPrice: Number(matching[0].unitPrice),
        };
      }
    }
    if (best) {
      bonuses.push(best);
      applied.add(best.ruleId);
    }
  }

  // 3. Invoice discount
  const gross = round4(evaluated.reduce((s, l) => s + l.gross, 0));
  const subtotal = round4(evaluated.reduce((s, l) => s + l.net, 0));
  const manual = round4(Number(context.manualInvoiceDiscount || 0));
  let invoiceDiscount: InvoiceDiscountResult = { amount: 0, ruleId: null, manual: false };
  if (manual > 0) {
    invoiceDiscount = { amount: Math.min(manual, subtotal), ruleId: null, manual: true };
  } else {
    const candidate = rules.invoiceDiscounts
      .filter((r) => invoiceRuleMatches(r, context, subtotal))
      .sort(
        (a, b) =>
          Number(a.priority || 0) - Number(b.priority || 0) ||
          timeOf(a.createdAt) - timeOf(b.createdAt),
      )[0];
    if (candidate) {
      const amount = invoiceDiscountAmount(candidate, subtotal);
      if (amount > 0) {
        invoiceDiscount = { amount, ruleId: candidate.id, manual: false };
        applied.add(candidate.id);
      }
    }
  }

  const offers = evaluated.reduce((s, l) => s + l.offerDiscount, 0);
  return {
    lines: evaluated,
    bonuses,
    gross,
    subtotal,
    invoiceDiscount,
    appliedRuleIds: [...applied],
    promotionDiscount: round4(offers + (invoiceDiscount.manual ? 0 : invoiceDiscount.amount)),
  };
}

/**
 * Spreads a document-level discount over lines in proportion to their net
 * amount; the last line takes the rounding remainder.
 */
export function allocateDiscount(nets: number[], amount: number): number[] {
  const total = nets.reduce((s, n) => s + Math.max(n, 0), 0);
  if (!(amount > 0) || total <= 0) return nets.map(() => 0);
  const capped = Math.min(amount, total);
  const result: number[] = [];
  let remaining = round4(capped);
  let lastIndex = -1;
  nets.forEach((n, i) => {
    if (n > 0) lastIndex = i;
  });
  nets.forEach((n, i) => {
    if (n <= 0) return result.push(0);
    if (i === lastIndex) {
      result.push(round4(Math.min(remaining, n)));
      remaining = 0;
      return;
    }
    const share = round4(Math.min((capped * n) / total, n, remaining));
    remaining = round4(remaining - share);
    result.push(share);
  });
  return result;
}

/**
 * Manual discount ratio (Instasoft setting_account threshold):
 * (manual line discounts + manual invoice discount) / gross x 100.
 * Promotion discounts are deliberately excluded.
 */
export function manualDiscountPercent(
  gross: number,
  manualLineDiscounts: number,
  manualInvoiceDiscount: number,
): number {
  if (!(gross > 0)) return 0;
  return ((Number(manualLineDiscounts) + Number(manualInvoiceDiscount)) / gross) * 100;
}
