import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, Repository } from 'typeorm';
import { Product } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { RbacService } from '@modules/auth/services/rbac.service';
import { round, today } from '@shared/utils/document-totals.util';
import { PromotionCampaign } from '../entities/promotion-campaign.entity';
import { PromotionBonusRule } from '../entities/promotion-bonus-rule.entity';
import { PromotionInvoiceDiscount } from '../entities/promotion-invoice-discount.entity';
import { PromotionDocumentType, PromotionUsage } from '../entities/promotion-usage.entity';
import { PromotionSettings } from '../entities/promotion-settings.entity';
import { PromotionRuleBase } from '../entities/promotion-rule-base.entity';
import {
  CreateBonusRuleDto,
  CreateCampaignDto,
  CreateInvoiceDiscountDto,
  EvaluatePromotionsDto,
  PriceCheckQueryDto,
  PromotionRuleBaseDto,
  UpdateBonusRuleDto,
  UpdateCampaignDto,
  UpdateInvoiceDiscountDto,
  UpdatePromotionSettingsDto,
} from '../dto/promotion.dto';
import {
  PaymentCondition,
  PromotionChannel,
  PromotionEvaluation,
  PromotionRuleSet,
  PromotionRuleType,
  allocateDiscount,
  evaluatePromotions,
  manualDiscountPercent,
  ruleApplies,
  round4,
} from '../engine/promotion-engine';

export const PROMOTION_DISCOUNT_OVERRIDE = {
  module: 'promotions',
  screen: 'discounts',
  action: 'override',
};

export interface DocumentPromotionContext {
  channel: PromotionChannel;
  date: string;
  /** HH:mm; null = rules with an hour window do not apply. */
  time?: string | null;
  branchId?: string | null;
  paymentCondition: PaymentCondition;
}

export interface DocumentLineBase {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate?: number;
  description?: string;
}

export interface ApplyPromotionsOptions {
  userId: string;
  /** false = no automatic promotion; the manual invoice discount and the limit still apply. */
  applyPromotions?: boolean;
  /** Manual invoice discount (amount), spread over the lines. */
  manualInvoiceDiscount?: number | null;
  /** Already known override right (e.g. pos/discounts/override). */
  canOverrideDiscount?: boolean;
}

export type AppliedLine<T> = T & {
  discount: number;
  /** Manual line discount + share of a manual invoice discount. */
  manualDiscount: number;
  /** Offer discount + share of an automatic invoice discount. */
  promotionDiscount: number;
  isBonus: boolean;
};

export interface PendingUsage {
  ruleType: PromotionRuleType;
  ruleId: string;
  discountAmount: number;
  bonusQty: number;
}

export interface AppliedPromotions<T> {
  lines: AppliedLine<T>[];
  usages: PendingUsage[];
  evaluation: PromotionEvaluation;
}

export interface LoadedRules extends PromotionRuleSet {
  campaigns: PromotionCampaign[];
  bonuses: PromotionBonusRule[];
  invoiceDiscounts: PromotionInvoiceDiscount[];
}

const EMPTY_RULES: LoadedRules = { campaigns: [], bonuses: [], invoiceDiscounts: [] };

/** Current server-local time as HH:mm. */
export function currentTime(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Hour windows only apply to documents dated today (time of entry). */
export function timeForDate(date: string): string | null {
  return date === today() ? currentTime() : null;
}

@Injectable()
export class PromotionsService {
  constructor(
    @InjectRepository(PromotionCampaign)
    private readonly campaignRepo: Repository<PromotionCampaign>,
    @InjectRepository(PromotionBonusRule)
    private readonly bonusRepo: Repository<PromotionBonusRule>,
    @InjectRepository(PromotionInvoiceDiscount)
    private readonly invoiceDiscountRepo: Repository<PromotionInvoiceDiscount>,
    @InjectRepository(PromotionUsage)
    private readonly usageRepo: Repository<PromotionUsage>,
    @InjectRepository(PromotionSettings)
    private readonly settingsRepo: Repository<PromotionSettings>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  // ---------------------------------------------------------------- rules CRUD

  findCampaigns(tenantId: string, activeOnly = false) {
    return this.campaignRepo.find({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  findBonusRules(tenantId: string, activeOnly = false) {
    return this.bonusRepo.find({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  findInvoiceDiscounts(tenantId: string, activeOnly = false) {
    return this.invoiceDiscountRepo.find({
      where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  getCampaign(tenantId: string, id: string) {
    return this.getRule(this.campaignRepo, tenantId, id, 'Campaign');
  }

  getBonusRule(tenantId: string, id: string) {
    return this.getRule(this.bonusRepo, tenantId, id, 'Bonus rule');
  }

  getInvoiceDiscount(tenantId: string, id: string) {
    return this.getRule(this.invoiceDiscountRepo, tenantId, id, 'Invoice discount');
  }

  async createCampaign(tenantId: string, userId: string, dto: CreateCampaignDto) {
    const rule = this.campaignRepo.create({ ...this.baseFields(dto), tenantId, createdBy: userId });
    Object.assign(rule, {
      productIds: dto.productIds ?? [],
      categoryIds: dto.categoryIds ?? [],
      discountType: dto.discountType,
      value: dto.value,
    });
    this.validateCampaign(rule);
    return this.campaignRepo.save(rule);
  }

  async updateCampaign(tenantId: string, id: string, dto: UpdateCampaignDto) {
    const rule = await this.getCampaign(tenantId, id);
    Object.assign(rule, this.baseFields(dto, rule));
    if (dto.productIds !== undefined) rule.productIds = dto.productIds;
    if (dto.categoryIds !== undefined) rule.categoryIds = dto.categoryIds;
    if (dto.discountType !== undefined) rule.discountType = dto.discountType;
    if (dto.value !== undefined) rule.value = dto.value;
    this.validateCampaign(rule);
    return this.campaignRepo.save(rule);
  }

  async createBonusRule(tenantId: string, userId: string, dto: CreateBonusRuleDto) {
    const rule = this.bonusRepo.create({ ...this.baseFields(dto), tenantId, createdBy: userId });
    Object.assign(rule, {
      productId: dto.productId,
      unitId: dto.unitId ?? null,
      freeProductId: dto.freeProductId ?? null,
      tiers: (dto.tiers ?? []).map((t) => ({ minQty: Number(t.minQty), freeQty: Number(t.freeQty) })),
      repeat: dto.repeat ?? false,
    });
    await this.validateBonus(tenantId, rule);
    return this.bonusRepo.save(rule);
  }

  async updateBonusRule(tenantId: string, id: string, dto: UpdateBonusRuleDto) {
    const rule = await this.getBonusRule(tenantId, id);
    Object.assign(rule, this.baseFields(dto, rule));
    if (dto.productId !== undefined) rule.productId = dto.productId;
    if (dto.unitId !== undefined) rule.unitId = dto.unitId ?? null;
    if (dto.freeProductId !== undefined) rule.freeProductId = dto.freeProductId ?? null;
    if (dto.tiers !== undefined) {
      rule.tiers = dto.tiers.map((t) => ({ minQty: Number(t.minQty), freeQty: Number(t.freeQty) }));
    }
    if (dto.repeat !== undefined) rule.repeat = dto.repeat;
    await this.validateBonus(tenantId, rule);
    return this.bonusRepo.save(rule);
  }

  async createInvoiceDiscount(tenantId: string, userId: string, dto: CreateInvoiceDiscountDto) {
    const rule = this.invoiceDiscountRepo.create({
      ...this.baseFields(dto),
      tenantId,
      createdBy: userId,
    });
    Object.assign(rule, {
      discountType: dto.discountType,
      value: dto.value,
      minSubtotal: dto.minSubtotal ?? 0,
      maxSubtotal: dto.maxSubtotal ?? null,
      paymentCondition: dto.paymentCondition ?? 'any',
      priority: dto.priority ?? 0,
    });
    this.validateInvoiceDiscount(rule);
    return this.invoiceDiscountRepo.save(rule);
  }

  async updateInvoiceDiscount(tenantId: string, id: string, dto: UpdateInvoiceDiscountDto) {
    const rule = await this.getInvoiceDiscount(tenantId, id);
    Object.assign(rule, this.baseFields(dto, rule));
    if (dto.discountType !== undefined) rule.discountType = dto.discountType;
    if (dto.value !== undefined) rule.value = dto.value;
    if (dto.minSubtotal !== undefined) rule.minSubtotal = dto.minSubtotal;
    if (dto.maxSubtotal !== undefined) rule.maxSubtotal = dto.maxSubtotal ?? null;
    if (dto.paymentCondition !== undefined) rule.paymentCondition = dto.paymentCondition;
    if (dto.priority !== undefined) rule.priority = dto.priority;
    this.validateInvoiceDiscount(rule);
    return this.invoiceDiscountRepo.save(rule);
  }

  async setActive(tenantId: string, type: PromotionRuleType, id: string, isActive: boolean) {
    const repo = this.repoFor(type) as Repository<PromotionRuleBase>;
    const rule = await this.getRule(repo, tenantId, id, 'Promotion rule');
    rule.isActive = isActive;
    return repo.save(rule);
  }

  /** Deletes a rule that was never used; used rules can only be deactivated. */
  async remove(tenantId: string, type: PromotionRuleType, id: string) {
    const repo = this.repoFor(type) as Repository<PromotionRuleBase>;
    const rule = await this.getRule(repo, tenantId, id, 'Promotion rule');
    const used = await this.usageRepo.count({ where: { tenantId, ruleId: id } });
    if (used > 0) {
      throw new ConflictException('This promotion has been used on documents; deactivate it instead');
    }
    await repo.remove(rule);
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<PromotionSettings> {
    const found = await this.settingsRepo.findOne({ where: { tenantId } });
    return found ?? this.settingsRepo.create({ tenantId, maxTotalDiscountPercent: null });
  }

  async updateSettings(tenantId: string, dto: UpdatePromotionSettingsDto) {
    const settings = await this.getSettings(tenantId);
    if (dto.maxTotalDiscountPercent !== undefined) {
      settings.maxTotalDiscountPercent = dto.maxTotalDiscountPercent;
    }
    return this.settingsRepo.save(settings);
  }

  // ---------------------------------------------------------------- engine

  /** Active rules of the tenant (date, branch, channel... are filtered by the engine). */
  async loadRules(tenantId: string): Promise<LoadedRules> {
    const [campaigns, bonuses, invoiceDiscounts] = await Promise.all([
      this.campaignRepo.find({ where: { tenantId, isActive: true } }),
      this.bonusRepo.find({ where: { tenantId, isActive: true } }),
      this.invoiceDiscountRepo.find({ where: { tenantId, isActive: true } }),
    ]);
    return {
      campaigns: campaigns.map((c) => Object.assign(c, { value: Number(c.value) })),
      bonuses,
      invoiceDiscounts: invoiceDiscounts.map((d) =>
        Object.assign(d, {
          value: Number(d.value),
          minSubtotal: Number(d.minSubtotal || 0),
          maxSubtotal:
            d.maxSubtotal === null || d.maxSubtotal === undefined ? null : Number(d.maxSubtotal),
        }),
      ),
    };
  }

  /**
   * Applies promotions to document lines priced by the caller: offer
   * discounts and the invoice discount (manual or automatic) are added to
   * the line discounts (so tax is computed after them), bonus units are
   * appended as zero-price lines, and the manual discount limit is enforced.
   */
  async applyToDocument<T extends DocumentLineBase>(
    tenantId: string,
    context: DocumentPromotionContext,
    lines: T[],
    options: ApplyPromotionsOptions,
  ): Promise<AppliedPromotions<T>> {
    const apply = options.applyPromotions !== false;
    const rules = apply ? await this.loadRules(tenantId) : EMPTY_RULES;
    const ids = new Set(lines.map((l) => l.productId));
    rules.bonuses.forEach((b) => b.freeProductId && ids.add(b.freeProductId));
    const products = ids.size
      ? await this.productRepo.find({ where: { tenantId, id: In([...ids]) } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const chains = rules.campaigns.some((c) => c.categoryIds?.length)
      ? await this.categoryChains(tenantId)
      : null;

    const manualInvoiceDiscount = round4(Number(options.manualInvoiceDiscount || 0));
    const evaluation = evaluatePromotions(
      { ...context, manualInvoiceDiscount },
      lines.map((l) => {
        const product = byId.get(l.productId);
        return {
          productId: l.productId,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: Number(l.discount || 0),
          unitId: product?.unitId ?? null,
          categoryChain: product && chains ? chains(product.categoryId) : [],
        };
      }),
      rules,
    );
    if (manualInvoiceDiscount > evaluation.subtotal + 0.0001) {
      throw new BadRequestException(
        `Invoice discount ${manualInvoiceDiscount} exceeds the subtotal ${evaluation.subtotal}`,
      );
    }

    await this.enforceDiscountLimit(tenantId, evaluation, manualInvoiceDiscount, options);

    const shares = allocateDiscount(
      evaluation.lines.map((l) => l.net),
      evaluation.invoiceDiscount.amount,
    );
    const isManualInvoice = evaluation.invoiceDiscount.manual;
    const result: AppliedLine<T>[] = lines.map((line, i) => {
      const ev = evaluation.lines[i];
      const share = shares[i];
      return {
        ...line,
        discount: round4(ev.manualDiscount + ev.offerDiscount + share),
        manualDiscount: round4(ev.manualDiscount + (isManualInvoice ? share : 0)),
        promotionDiscount: round4(ev.offerDiscount + (isManualInvoice ? 0 : share)),
        isBonus: false,
      };
    });

    const names = new Map(rules.bonuses.map((b) => [b.id, b]));
    const usages: PendingUsage[] = [];
    for (const bonus of evaluation.bonuses) {
      const product = byId.get(bonus.productId);
      if (!product || product.isActive === false) continue;
      const rule = names.get(bonus.ruleId);
      result.push({
        productId: bonus.productId,
        quantity: bonus.freeQty,
        unitPrice: 0,
        discount: 0,
        taxRate: Number(product.salesTaxRate ?? 0),
        description: `Bonus: ${rule?.nameEn || rule?.nameAr || product.code}`,
        manualDiscount: 0,
        promotionDiscount: 0,
        isBonus: true,
      } as unknown as AppliedLine<T>);
      // The value given away: free units at the price of the purchased product
      // (or the free product's own price when it differs).
      const unitValue =
        bonus.productId === bonus.sourceProductId ? bonus.unitPrice : Number(product.sellPrice || 0);
      usages.push({
        ruleType: 'bonus',
        ruleId: bonus.ruleId,
        discountAmount: round4(unitValue * bonus.freeQty),
        bonusQty: bonus.freeQty,
      });
    }

    const perCampaign = new Map<string, number>();
    for (const l of evaluation.lines) {
      if (l.campaignId && l.offerDiscount > 0) {
        perCampaign.set(l.campaignId, round4((perCampaign.get(l.campaignId) ?? 0) + l.offerDiscount));
      }
    }
    for (const [ruleId, amount] of perCampaign) {
      usages.push({ ruleType: 'campaign', ruleId, discountAmount: amount, bonusQty: 0 });
    }
    if (evaluation.invoiceDiscount.ruleId) {
      usages.push({
        ruleType: 'invoice_discount',
        ruleId: evaluation.invoiceDiscount.ruleId,
        discountAmount: evaluation.invoiceDiscount.amount,
        bonusQty: 0,
      });
    }

    return { lines: result, usages, evaluation };
  }

  /** Preview for tills and price checkers: nothing is saved. */
  async evaluate(tenantId: string, userId: string, dto: EvaluatePromotionsDto) {
    const date = dto.date || today();
    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.productRepo.find({ where: { tenantId, id: In(productIds) } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines = dto.lines.map((l) => {
      const product = byId.get(l.productId);
      if (!product) throw new NotFoundException(`Product ${l.productId} not found`);
      return {
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice ?? Number(product.sellPrice || 0),
        discount: Number(l.discount || 0),
        taxRate: Number(product.salesTaxRate ?? 0),
      };
    });
    const applied = await this.applyToDocument(
      tenantId,
      {
        channel: dto.channel ?? 'pos',
        date,
        time: dto.time ?? timeForDate(date),
        branchId: dto.branchId ?? null,
        paymentCondition: dto.paymentCondition ?? 'cash',
      },
      lines,
      {
        userId,
        manualInvoiceDiscount: dto.invoiceDiscount,
        // A preview never refuses: the limit is enforced when the document is saved.
        canOverrideDiscount: true,
      },
    );
    const { evaluation } = applied;
    return {
      date,
      gross: evaluation.gross,
      subtotal: evaluation.subtotal,
      invoiceDiscount: evaluation.invoiceDiscount,
      totalAfterDiscounts: round4(evaluation.subtotal - evaluation.invoiceDiscount.amount),
      promotionDiscount: evaluation.promotionDiscount,
      appliedRuleIds: evaluation.appliedRuleIds,
      bonuses: evaluation.bonuses,
      lines: applied.lines.map((l, i) => ({
        ...l,
        offerDiscount: l.isBonus ? 0 : evaluation.lines[i].offerDiscount,
        campaignId: l.isBonus ? null : evaluation.lines[i].campaignId,
        netAmount: round4(Number(l.quantity) * Number(l.unitPrice) - l.discount),
      })),
      usages: applied.usages,
    };
  }

  // ---------------------------------------------------------------- usage

  async recordUsages(
    tenantId: string,
    documentType: PromotionDocumentType,
    documentId: string,
    date: string,
    usages: PendingUsage[],
  ): Promise<void> {
    if (!usages?.length) return;
    await this.usageRepo.save(
      usages.map((u) =>
        this.usageRepo.create({
          tenantId,
          documentType,
          documentId,
          date,
          ruleType: u.ruleType,
          ruleId: u.ruleId,
          discountAmount: u.discountAmount,
          bonusQty: u.bonusQty,
          isVoid: false,
        }),
      ),
    );
  }

  /** Cancelled documents leave the promotion cost report. */
  async voidUsages(tenantId: string, documentType: PromotionDocumentType, documentId: string) {
    await this.usageRepo.update({ tenantId, documentType, documentId }, { isVoid: true });
  }

  findUsages(tenantId: string, documentType?: PromotionDocumentType, documentId?: string) {
    return this.usageRepo.find({
      where: {
        tenantId,
        ...(documentType ? { documentType } : {}),
        ...(documentId ? { documentId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: 500,
    });
  }

  /** Promotion cost per rule for a period (cancelled documents excluded). */
  async costReport(tenantId: string, from: string, to: string) {
    if (from > to) throw new BadRequestException('from must be before to');
    const usages = await this.usageRepo.find({
      where: { tenantId, isVoid: false, date: Between(from, to) },
    });
    const rows = new Map<
      string,
      {
        ruleType: PromotionRuleType;
        ruleId: string;
        nameAr: string | null;
        nameEn: string | null;
        documents: Set<string>;
        discountAmount: number;
        bonusQty: number;
      }
    >();
    for (const u of usages) {
      const key = `${u.ruleType}:${u.ruleId}`;
      const row = rows.get(key) ?? {
        ruleType: u.ruleType,
        ruleId: u.ruleId,
        nameAr: null,
        nameEn: null,
        documents: new Set<string>(),
        discountAmount: 0,
        bonusQty: 0,
      };
      row.documents.add(`${u.documentType}:${u.documentId}`);
      row.discountAmount = round4(row.discountAmount + Number(u.discountAmount));
      row.bonusQty = round4(row.bonusQty + Number(u.bonusQty));
      rows.set(key, row);
    }
    for (const type of ['campaign', 'bonus', 'invoice_discount'] as PromotionRuleType[]) {
      const ids = [...rows.values()].filter((r) => r.ruleType === type).map((r) => r.ruleId);
      if (!ids.length) continue;
      const repo = this.repoFor(type) as Repository<PromotionRuleBase>;
      const rules = await repo.find({ where: { tenantId, id: In(ids) } });
      for (const rule of rules) {
        const row = rows.get(`${type}:${rule.id}`);
        if (row) {
          row.nameAr = rule.nameAr;
          row.nameEn = rule.nameEn;
        }
      }
    }
    const result = [...rows.values()]
      .map(({ documents, ...r }) => ({ ...r, documents: documents.size }))
      .sort((a, b) => b.discountAmount - a.discountAmount);
    return {
      from,
      to,
      rows: result,
      totalDiscount: round(result.reduce((s, r) => s + r.discountAmount, 0), 4),
    };
  }

  // ---------------------------------------------------------------- price check

  /**
   * Price checker (Instasoft PriceCheckForm): list price, the price after the
   * best active item campaign, and up to 5 cheaper products of the same category.
   */
  async priceCheck(tenantId: string, query: PriceCheckQueryDto) {
    let product: Product | null = null;
    if (query.productId) {
      product = await this.productRepo.findOne({ where: { tenantId, id: query.productId } });
    } else if (query.code) {
      product =
        (await this.productRepo.findOne({ where: { tenantId, barcode: query.code } })) ??
        (await this.productRepo.findOne({ where: { tenantId, code: query.code } }));
    } else {
      throw new BadRequestException('productId or code is required');
    }
    if (!product) throw new NotFoundException('Product not found');

    const listPrice = Number(product.sellPrice || 0);
    const date = today();
    const rules = await this.loadRules(tenantId);
    const chains = await this.categoryChains(tenantId);
    const context = {
      channel: query.channel ?? 'pos',
      date,
      time: currentTime(),
      branchId: query.branchId ?? null,
      paymentCondition: 'cash' as const,
    };
    const evaluation = evaluatePromotions(
      context,
      [
        {
          productId: product.id,
          quantity: 1,
          unitPrice: listPrice,
          unitId: product.unitId,
          categoryChain: chains(product.categoryId),
        },
      ],
      { campaigns: rules.campaigns, bonuses: rules.bonuses, invoiceDiscounts: [] },
    );
    const line = evaluation.lines[0];
    const campaign = line.campaignId
      ? rules.campaigns.find((c) => c.id === line.campaignId) ?? null
      : null;

    const alternatives = await this.productRepo.find({
      where: {
        tenantId,
        categoryId: product.categoryId,
        isActive: true,
        sellPrice: LessThan(listPrice),
      },
      order: { sellPrice: 'DESC' },
      take: 5,
    });

    return {
      product: {
        id: product.id,
        code: product.code,
        barcode: product.barcode,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        taxRate: Number(product.salesTaxRate ?? 0),
      },
      listPrice,
      campaignPrice: campaign ? round4(listPrice - line.offerDiscount) : null,
      campaign: campaign
        ? {
            id: campaign.id,
            nameAr: campaign.nameAr,
            nameEn: campaign.nameEn,
            discountType: campaign.discountType,
            value: Number(campaign.value),
            validTo: campaign.validTo,
          }
        : null,
      // Bonus offers currently running on the product (the tiers tell the customer what to buy).
      bonusRules: rules.bonuses
        .filter((b) => b.productId === product!.id && ruleApplies(b, context))
        .map((b) => ({
          id: b.id,
          nameAr: b.nameAr,
          nameEn: b.nameEn,
          freeProductId: b.freeProductId ?? product!.id,
          tiers: b.tiers,
          repeat: b.repeat,
        })),
      alternatives: alternatives.map((p) => ({
        id: p.id,
        code: p.code,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        sellPrice: Number(p.sellPrice),
      })),
    };
  }

  // ---------------------------------------------------------------- helpers

  private async enforceDiscountLimit(
    tenantId: string,
    evaluation: PromotionEvaluation,
    manualInvoiceDiscount: number,
    options: ApplyPromotionsOptions,
  ) {
    const manualLines = evaluation.lines.reduce((s, l) => s + l.manualDiscount, 0);
    if (manualLines <= 0 && manualInvoiceDiscount <= 0) return;
    const settings = await this.getSettings(tenantId);
    if (settings.maxTotalDiscountPercent === null || settings.maxTotalDiscountPercent === undefined) {
      return;
    }
    const limit = Number(settings.maxTotalDiscountPercent);
    const pct = manualDiscountPercent(evaluation.gross, manualLines, manualInvoiceDiscount);
    if (pct <= limit + 0.0001) return;
    if (options.canOverrideDiscount) return;
    const allowed = this.rbac
      ? await this.rbac.hasPermission(tenantId, options.userId, PROMOTION_DISCOUNT_OVERRIDE)
      : false;
    if (!allowed) {
      throw new ForbiddenException(
        `Total discount of ${round(pct, 2)}% exceeds the ${limit}% allowed; requires promotions/discounts/override`,
      );
    }
  }

  /** Returns a function giving a category followed by its ancestors. */
  private async categoryChains(tenantId: string): Promise<(categoryId: string | null) => string[]> {
    const categories = await this.categoryRepo.find({ where: { tenantId } });
    const parent = new Map(categories.map((c) => [c.id, c.parentId ?? null]));
    return (categoryId) => {
      const chain: string[] = [];
      let current = categoryId;
      while (current && !chain.includes(current) && chain.length < 50) {
        chain.push(current);
        current = parent.get(current) ?? null;
      }
      return chain;
    };
  }

  private repoFor(type: PromotionRuleType) {
    switch (type) {
      case 'campaign':
        return this.campaignRepo;
      case 'bonus':
        return this.bonusRepo;
      case 'invoice_discount':
        return this.invoiceDiscountRepo;
      default:
        throw new BadRequestException(`Unknown promotion type ${type}`);
    }
  }

  private async getRule<E extends PromotionRuleBase>(
    repo: Repository<E>,
    tenantId: string,
    id: string,
    label: string,
  ): Promise<E> {
    const rule = await repo.findOne({ where: { id, tenantId } as any });
    if (!rule) throw new NotFoundException(`${label} not found`);
    return rule;
  }

  private baseFields(dto: Partial<PromotionRuleBaseDto>, current?: PromotionRuleBase) {
    const fields: Partial<PromotionRuleBase> = {};
    if (dto.nameAr !== undefined) fields.nameAr = dto.nameAr;
    if (dto.nameEn !== undefined) fields.nameEn = dto.nameEn;
    if (dto.isActive !== undefined || !current) fields.isActive = dto.isActive ?? true;
    if (dto.validFrom !== undefined || !current) fields.validFrom = dto.validFrom ?? null;
    if (dto.validTo !== undefined || !current) fields.validTo = dto.validTo ?? null;
    if (dto.appliesTo !== undefined || !current) fields.appliesTo = dto.appliesTo ?? 'both';
    if (dto.branchIds !== undefined || !current) fields.branchIds = dto.branchIds ?? [];
    if (dto.weekdays !== undefined || !current) fields.weekdays = dto.weekdays ?? [];
    if (dto.startTime !== undefined || !current) fields.startTime = dto.startTime ?? null;
    if (dto.endTime !== undefined || !current) fields.endTime = dto.endTime ?? null;
    if (dto.notes !== undefined) fields.notes = dto.notes;
    const merged = { ...current, ...fields };
    if (merged.validFrom && merged.validTo && merged.validFrom > merged.validTo) {
      throw new BadRequestException('validFrom must be on or before validTo');
    }
    if (!merged.startTime !== !merged.endTime) {
      throw new BadRequestException('An hour window needs both startTime and endTime');
    }
    return fields;
  }

  private validateCampaign(rule: PromotionCampaign) {
    if (!rule.productIds?.length && !rule.categoryIds?.length) {
      throw new BadRequestException('A campaign needs at least one product or category');
    }
    if (!(Number(rule.value) > 0)) throw new BadRequestException('The discount value must be positive');
    if (rule.discountType === 'percent' && Number(rule.value) > 100) {
      throw new BadRequestException('A percent discount cannot exceed 100');
    }
  }

  private async validateBonus(tenantId: string, rule: PromotionBonusRule) {
    if (!rule.tiers?.length) throw new BadRequestException('A bonus rule needs at least one tier');
    const mins = rule.tiers.map((t) => Number(t.minQty));
    if (new Set(mins).size !== mins.length) {
      throw new BadRequestException('Bonus tiers must have different minimum quantities');
    }
    if (rule.tiers.some((t) => !(Number(t.minQty) > 0) || !(Number(t.freeQty) > 0))) {
      throw new BadRequestException('Tier quantities must be positive');
    }
    const ids = [...new Set([rule.productId, rule.freeProductId].filter(Boolean) as string[])];
    const found = await this.productRepo.find({ where: { tenantId, id: In(ids) } });
    if (found.length !== ids.length) throw new NotFoundException('Product not found');
  }

  private validateInvoiceDiscount(rule: PromotionInvoiceDiscount) {
    if (!(Number(rule.value) > 0)) throw new BadRequestException('The discount value must be positive');
    if (rule.discountType === 'percent' && Number(rule.value) > 100) {
      throw new BadRequestException('A percent discount cannot exceed 100');
    }
    if (
      rule.maxSubtotal !== null &&
      rule.maxSubtotal !== undefined &&
      Number(rule.maxSubtotal) < Number(rule.minSubtotal || 0)
    ) {
      throw new BadRequestException('maxSubtotal must be greater than or equal to minSubtotal');
    }
  }
}
