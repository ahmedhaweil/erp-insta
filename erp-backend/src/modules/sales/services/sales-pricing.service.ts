import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PriceList } from '../entities/price-list.entity';
import { PriceListRule, PriceRuleType } from '../entities/price-list-rule.entity';
import { Customer } from '../entities/customer.entity';
import { CustomerCategory } from '../entities/customer-category.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { RbacService } from '@modules/auth/services/rbac.service';
import { ComputedLine, round, today } from '@shared/utils/document-totals.util';

export const PRICE_OVERRIDE_PERMISSION = {
  module: 'sales',
  screen: 'price_override',
  action: 'update',
};

export interface PriceQuery {
  productId: string;
  customerId?: string;
  quantity?: number;
  date?: string;
  /** Explicit price list (overrides the customer / customer category list). */
  priceListId?: string;
}

export interface PriceResult {
  productId: string;
  quantity: number;
  date: string;
  unitPrice: number;
  /** Product sales price before the price list. */
  basePrice: number;
  priceListId: string | null;
  ruleId: string | null;
  ruleType: PriceRuleType | null;
  currencyId: string | null;
  minSellPrice: number | null;
}

export interface PricedLineInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

const isValidAt = (from: string | null | undefined, to: string | null | undefined, date: string) =>
  (!from || from <= date) && (!to || to >= date);

/**
 * Price list engine (Odoo product.pricelist): resolves the price list of a
 * customer (explicit > customer > customer category), picks the best rule for
 * a product / quantity / date and enforces minimum selling prices.
 */
@Injectable()
export class SalesPricingService {
  constructor(
    @InjectRepository(PriceList)
    private readonly priceListRepo: Repository<PriceList>,
    @InjectRepository(PriceListRule)
    private readonly ruleRepo: Repository<PriceListRule>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerCategory)
    private readonly customerCategoryRepo: Repository<CustomerCategory>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Category)
    private readonly productCategoryRepo: Repository<Category>,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  /**
   * Picks the applicable rule: product rules beat category rules (closest
   * category first) which beat global rules; within the same scope the
   * highest quantity tier reached wins.
   */
  static pickRule(
    rules: PriceListRule[],
    productId: string,
    categoryChain: string[],
    quantity: number,
    date: string,
  ): PriceListRule | null {
    const scopeRank = (rule: PriceListRule): number => {
      if (rule.productId) return rule.productId === productId ? 0 : -1;
      if (rule.categoryId) {
        const idx = categoryChain.indexOf(rule.categoryId);
        return idx < 0 ? -1 : 1 + idx;
      }
      return 1000;
    };
    let best: PriceListRule | null = null;
    let bestRank = Infinity;
    for (const rule of rules) {
      const rank = scopeRank(rule);
      if (rank < 0) continue;
      if (Number(rule.minQuantity || 0) > quantity + 0.0001) continue;
      if (!isValidAt(rule.validFrom, rule.validTo, date)) continue;
      if (
        rank < bestRank ||
        (rank === bestRank && Number(rule.minQuantity) > Number(best!.minQuantity))
      ) {
        best = rule;
        bestRank = rank;
      }
    }
    return best;
  }

  static applyRule(
    rule: PriceListRule | null,
    product: Pick<Product, 'sellPrice' | 'costPrice'>,
  ): number {
    const sell = Number(product.sellPrice || 0);
    if (!rule) return sell;
    const value = Number(rule.value);
    switch (rule.ruleType) {
      case PriceRuleType.FIXED:
        return round(value, 4);
      case PriceRuleType.DISCOUNT:
        return round(sell * (1 - value / 100), 4);
      case PriceRuleType.MARKUP:
        return round(Number(product.costPrice || 0) * (1 + value / 100), 4);
      default:
        return sell;
    }
  }

  /** Sets (or clears with null) the minimum selling price of a product. */
  async setMinSellPrice(tenantId: string, productId: string, minSellPrice: number | null) {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    if (minSellPrice !== null && minSellPrice < 0) {
      throw new BadRequestException('The minimum selling price cannot be negative');
    }
    product.minSellPrice = minSellPrice;
    await this.productRepo.save(product);
    return { productId: product.id, code: product.code, minSellPrice };
  }

  /** Price list of a customer: explicit list, else customer list, else category list. */
  async resolvePriceListId(
    tenantId: string,
    customer: Pick<Customer, 'priceListId' | 'categoryId'> | null,
    explicit?: string | null,
  ): Promise<string | null> {
    if (explicit) return explicit;
    if (customer?.priceListId) return customer.priceListId;
    if (customer?.categoryId) {
      const category = await this.customerCategoryRepo.findOne({
        where: { id: customer.categoryId, tenantId },
      });
      if (category?.isActive !== false && category?.priceListId) return category.priceListId;
    }
    return null;
  }

  async computePrice(tenantId: string, query: PriceQuery): Promise<PriceResult> {
    const product = await this.productRepo.findOne({ where: { id: query.productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    let customer: Customer | null = null;
    if (query.customerId) {
      customer = await this.customerRepo.findOne({ where: { id: query.customerId, tenantId } });
      if (!customer) throw new NotFoundException('Customer not found');
    }
    const priceListId = await this.resolvePriceListId(tenantId, customer, query.priceListId);
    const [result] = await this.priceProducts(
      tenantId,
      priceListId,
      [{ product, quantity: Number(query.quantity ?? 1) }],
      query.date || today(),
    );
    return result;
  }

  /**
   * Fills the unit price of lines sent without one from the customer's price
   * list (or the product sales price). Lines with a price are kept as is.
   */
  async priceLines<T extends PricedLineInput>(
    tenantId: string,
    context: { customer: Customer; priceListId?: string | null; date: string },
    lines: T[],
  ): Promise<{ lines: (T & { unitPrice: number })[]; priceListId: string | null }> {
    const priceListId = await this.resolvePriceListId(
      tenantId,
      context.customer,
      context.priceListId,
    );
    const missing = lines.filter((l) => l.unitPrice === undefined || l.unitPrice === null);
    if (missing.length === 0) {
      return { lines: lines as (T & { unitPrice: number })[], priceListId };
    }
    const products = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(missing.map((l) => l.productId))]) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const priced = await this.priceProducts(
      tenantId,
      priceListId,
      missing.map((l) => {
        const product = byId.get(l.productId);
        if (!product) throw new NotFoundException(`Product ${l.productId} not found`);
        return { product, quantity: Number(l.quantity) };
      }),
      context.date,
    );
    let i = 0;
    const result = lines.map((l) =>
      l.unitPrice === undefined || l.unitPrice === null
        ? { ...l, unitPrice: priced[i++].unitPrice }
        : (l as T & { unitPrice: number }),
    );
    return { lines: result, priceListId };
  }

  /**
   * Refuses lines whose net unit price (after discount, excluding VAT, in
   * base currency) is below the product minimum selling price, unless the
   * user holds sales/price_override/update.
   */
  async enforceMinPrice(
    tenantId: string,
    userId: string,
    lines: (Pick<ComputedLine, 'quantity' | 'lineTotal'> & { productId: string })[],
    exchangeRate = 1,
  ): Promise<void> {
    if (lines.length === 0) return;
    const products = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(lines.map((l) => l.productId))]) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const violations: string[] = [];
    for (const line of lines) {
      const product = byId.get(line.productId);
      const min = product?.minSellPrice;
      if (min === null || min === undefined || !(Number(min) > 0)) continue;
      const netUnit = round(
        (Number(line.lineTotal) / Number(line.quantity)) * (Number(exchangeRate) || 1),
        4,
      );
      if (netUnit + 0.0001 < Number(min)) {
        violations.push(`${product!.code}: ${netUnit} < minimum ${Number(min)}`);
      }
    }
    if (violations.length === 0) return;
    const allowed = this.rbac
      ? await this.rbac.hasPermission(tenantId, userId, PRICE_OVERRIDE_PERMISSION)
      : false;
    if (!allowed) {
      throw new ForbiddenException(
        `Price below the minimum selling price (${violations.join('; ')}); requires sales/price_override/update`,
      );
    }
  }

  private async priceProducts(
    tenantId: string,
    priceListId: string | null,
    items: { product: Product; quantity: number }[],
    date: string,
  ): Promise<PriceResult[]> {
    let list: PriceList | null = null;
    let rules: PriceListRule[] = [];
    if (priceListId) {
      list = await this.priceListRepo.findOne({ where: { id: priceListId, tenantId } });
      if (!list) throw new NotFoundException('Price list not found');
      if (!list.isActive || !isValidAt(list.validFrom, list.validTo, date)) {
        // Expired or archived lists fall back to the product sales price.
        list = null;
      } else {
        rules = await this.ruleRepo.find({ where: { priceListId: list.id } });
      }
    }

    const results: PriceResult[] = [];
    for (const { product, quantity } of items) {
      if (!(quantity > 0)) throw new BadRequestException('Quantity must be greater than zero');
      const chain = rules.length ? await this.categoryChain(tenantId, product.categoryId) : [];
      const rule = rules.length
        ? SalesPricingService.pickRule(rules, product.id, chain, quantity, date)
        : null;
      results.push({
        productId: product.id,
        quantity,
        date,
        unitPrice: SalesPricingService.applyRule(rule, product),
        basePrice: Number(product.sellPrice || 0),
        priceListId: list?.id ?? null,
        ruleId: rule?.id ?? null,
        ruleType: rule?.ruleType ?? null,
        currencyId: list?.currencyId ?? null,
        minSellPrice:
          product.minSellPrice === null || product.minSellPrice === undefined
            ? null
            : Number(product.minSellPrice),
      });
    }
    return results;
  }

  /** The product category followed by its ancestors (closest first). */
  private async categoryChain(tenantId: string, categoryId: string | null): Promise<string[]> {
    const chain: string[] = [];
    let current = categoryId;
    while (current && !chain.includes(current) && chain.length < 20) {
      chain.push(current);
      const category = await this.productCategoryRepo.findOne({
        where: { id: current, tenantId },
      });
      current = category?.parentId ?? null;
    }
    return chain;
  }
}
