import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  LandedCost,
  LandedCostAllocation,
  LandedCostSplit,
  LandedCostStatus,
} from '../entities/landed-cost.entity';
import { PurchaseOrder } from '../entities/purchase-order.entity';
import { CreateLandedCostDto } from '../dto/landed-cost.dto';
import { Product } from '@modules/inventory/entities/product.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { StockMovement } from '@modules/inventory/entities/stock-movement.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { AutoPostingService, PostingLine } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';

interface ReceivedGoods {
  productId: string;
  quantity: number;
  value: number;
}

/**
 * Splits landed costs over received quantities (by value, quantity or
 * equally), using cents-exact rounding so the shares add up to the total.
 */
export function splitLandedCost(
  goods: ReceivedGoods[],
  total: number,
  method: LandedCostSplit,
): { productId: string; share: number; amount: number }[] {
  const weight = (g: ReceivedGoods) =>
    method === LandedCostSplit.BY_QUANTITY ? g.quantity : method === LandedCostSplit.EQUAL ? 1 : g.value;
  const totalWeight = goods.reduce((s, g) => s + weight(g), 0);
  if (!(totalWeight > 0)) {
    throw new BadRequestException('The received goods have no value or quantity to spread the costs over');
  }
  let allocated = 0;
  return goods.map((g, i) => {
    const share = weight(g) / totalWeight;
    const amount = i === goods.length - 1 ? round(total - allocated, 2) : round(total * share, 2);
    allocated = round(allocated + amount, 2);
    return { productId: g.productId, share: round(share, 6), amount };
  });
}

/**
 * Landed costs on average costing: the part of each product's share that is
 * still in stock raises its average cost (Dr inventory); the part matching
 * goods already sold or consumed goes to cost of goods sold (Dr COGS); the
 * charges' accounts are credited.
 */
@Injectable()
export class LandedCostsService {
  constructor(
    @InjectRepository(LandedCost) private readonly landedRepo: Repository<LandedCost>,
    @InjectRepository(PurchaseOrder) private readonly orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Stock) private readonly stockRepo: Repository<Stock>,
    @InjectRepository(StockMovement) private readonly movementRepo: Repository<StockMovement>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string) {
    return this.landedRepo.find({ where: { tenantId }, order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string) {
    const landed = await this.landedRepo.findOne({ where: { id, tenantId } });
    if (!landed) throw new NotFoundException('Landed cost not found');
    return landed;
  }

  async create(tenantId: string, userId: string, dto: CreateLandedCostDto) {
    const ids = [...new Set(dto.purchaseOrderIds)];
    const found = await this.orderRepo.count({ where: { tenantId, id: In(ids) } });
    if (found !== ids.length) throw new NotFoundException('One or more purchase orders were not found');
    await this.assertAccounts(tenantId, dto.charges.map((c) => c.accountId).filter(Boolean) as string[]);
    const total = round(dto.charges.reduce((s, c) => s + Number(c.amount), 0), 2);
    return this.landedRepo.save(
      this.landedRepo.create({
        tenantId,
        number: await this.sequenceService.next(tenantId, 'landed_cost', 'LC'),
        date: dto.date,
        status: LandedCostStatus.DRAFT,
        splitMethod: dto.splitMethod ?? LandedCostSplit.BY_VALUE,
        purchaseOrderIds: ids,
        charges: dto.charges.map((c) => ({ ...c, amount: round(Number(c.amount), 2) })),
        totalAmount: total,
        notes: dto.notes,
        createdBy: userId,
      }),
    );
  }

  /** Computes the split without posting. */
  async preview(tenantId: string, id: string) {
    const landed = await this.findById(tenantId, id);
    return { ...landed, allocations: await this.computeAllocations(tenantId, landed) };
  }

  async post(tenantId: string, userId: string, id: string) {
    const landed = await this.findById(tenantId, id);
    if (landed.status !== LandedCostStatus.DRAFT) throw new ConflictException('Only draft landed costs can be posted');
    await this.autoPosting.preflight(tenantId, landed.date, ['inventoryAccountId', 'cogsAccountId', 'purchaseAccountId']);
    const allocations = await this.computeAllocations(tenantId, landed);

    for (const a of allocations) {
      if (a.inventoryAmount > 0) await this.revalue(tenantId, a.productId, a.inventoryAmount);
    }

    const inventory = round(allocations.reduce((s, a) => s + a.inventoryAmount, 0), 2);
    const cogs = round(allocations.reduce((s, a) => s + a.cogsAmount, 0), 2);
    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.PURCHASE,
      date: landed.date,
      description: `Landed costs ${landed.number}`,
      sourceType: 'landed_cost',
      sourceId: landed.id,
      buildLines: (_s, account) => {
        const lines: PostingLine[] = [
          { accountId: account('inventoryAccountId'), debit: inventory },
          { accountId: account('cogsAccountId'), debit: cogs },
        ];
        for (const c of landed.charges) {
          lines.push({
            accountId: c.accountId ?? account('purchaseAccountId'),
            credit: Number(c.amount),
            description: c.description,
          });
        }
        return lines;
      },
    });

    landed.allocations = allocations;
    landed.status = LandedCostStatus.POSTED;
    landed.postedAt = new Date();
    return this.landedRepo.save(landed);
  }

  /** Reverses the entry and takes the capitalised amounts back out of the products' average cost. */
  async cancel(tenantId: string, userId: string, id: string) {
    const landed = await this.findById(tenantId, id);
    if (landed.status === LandedCostStatus.CANCELLED) throw new ConflictException('Already cancelled');
    if (landed.status === LandedCostStatus.POSTED) {
      for (const a of landed.allocations ?? []) {
        if (a.inventoryAmount > 0) await this.revalue(tenantId, a.productId, -a.inventoryAmount);
      }
      await this.autoPosting.reverseSource(tenantId, userId, 'landed_cost', landed.id);
    }
    landed.status = LandedCostStatus.CANCELLED;
    return this.landedRepo.save(landed);
  }

  private async computeAllocations(tenantId: string, landed: LandedCost): Promise<LandedCostAllocation[]> {
    const goods = await this.receivedGoods(tenantId, landed.purchaseOrderIds);
    if (!goods.length) {
      throw new BadRequestException('Nothing has been received on these purchase orders yet');
    }
    const split = splitLandedCost(goods, Number(landed.totalAmount), landed.splitMethod);
    const result: LandedCostAllocation[] = [];
    for (const s of split) {
      const g = goods.find((x) => x.productId === s.productId)!;
      const onHand = await this.onHand(tenantId, s.productId);
      // Only the received units still in stock can carry the extra cost
      const ratio = Math.min(Math.max(onHand, 0), g.quantity) / g.quantity;
      const inventoryAmount = round(s.amount * ratio, 2);
      result.push({
        productId: s.productId,
        receivedQty: g.quantity,
        receivedValue: round(g.value, 2),
        share: s.share,
        amount: s.amount,
        inventoryAmount,
        cogsAmount: round(s.amount - inventoryAmount, 2),
      });
    }
    return result;
  }

  private async receivedGoods(tenantId: string, orderIds: string[]): Promise<ReceivedGoods[]> {
    const rows: { product_id: string; quantity: string; value: string }[] = await this.movementRepo
      .createQueryBuilder('m')
      .select('m.product_id', 'product_id')
      .addSelect('SUM(m.quantity)', 'quantity')
      .addSelect('SUM(m.quantity * m.unit_cost)', 'value')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere("m.reference_type = 'purchase_order'")
      .andWhere('m.reference_id IN (:...orderIds)', { orderIds })
      .groupBy('m.product_id')
      .orderBy('m.product_id')
      .getRawMany();
    return rows
      .map((r) => ({ productId: r.product_id, quantity: Number(r.quantity), value: Number(r.value) }))
      .filter((r) => r.quantity > 0);
  }

  private async onHand(tenantId: string, productId: string): Promise<number> {
    const row = await this.stockRepo
      .createQueryBuilder('s')
      .select('COALESCE(SUM(s.quantity), 0)', 'qty')
      .where('s.tenantId = :tenantId AND s.productId = :productId', { tenantId, productId })
      .getRawOne<{ qty: string }>();
    return Number(row?.qty ?? 0);
  }

  /** Adds (or removes) value to the stock on hand of a product: new average cost. */
  private async revalue(tenantId: string, productId: string, amount: number) {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) return;
    const onHand = await this.onHand(tenantId, productId);
    if (!(onHand > 0)) return;
    const value = Math.max(onHand * Number(product.costPrice || 0) + amount, 0);
    product.costPrice = round(value / onHand, 4);
    await this.productRepo.save(product);
  }

  private async assertAccounts(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = await this.accountRepo.count({ where: { tenantId, id: In(unique) } });
    if (found !== unique.length) throw new NotFoundException('One or more charge accounts do not exist');
  }
}
