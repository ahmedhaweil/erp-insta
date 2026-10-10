import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  StockIssue,
  StockIssueLine,
  StockIssueStatus,
  StockIssueType,
} from '../entities/stock-issue.entity';
import { Product, ProductType } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { StockMovementType } from '../entities/stock-movement.entity';
import { CreateStockIssueDto, StockIssueQueryDto } from '../dto/stock-issue.dto';
import { StockService } from './stock.service';
import { ProductsService } from './products.service';
import { Account } from '@modules/accounting/entities/account.entity';
import {
  AutoPostingService,
  SettingsAccountKey,
} from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';

/**
 * Default expense account of each issue type: damage (and internal use /
 * samples, unless the document names its own account) go to the stock
 * adjustment / loss account, donations to the donations expense account.
 */
export const STOCK_ISSUE_ACCOUNT: Record<StockIssueType, SettingsAccountKey> = {
  [StockIssueType.DAMAGE]: 'stockAdjustmentAccountId',
  [StockIssueType.DONATION]: 'donationsExpenseAccountId',
  [StockIssueType.INTERNAL_USE]: 'stockAdjustmentAccountId',
  [StockIssueType.SAMPLE]: 'stockAdjustmentAccountId',
};

/**
 * Stock issue documents (Instasoft item_damage / item_charity): damaged
 * goods, donations, internal consumption and samples. draft → posted
 * (goods issued at average cost through StockService, Dr expense /
 * Cr inventory) → cancelled (goods received back at the issued cost and the
 * entry reversed).
 */
@Injectable()
export class StockIssuesService {
  constructor(
    @InjectRepository(StockIssue)
    private readonly issueRepo: Repository<StockIssue>,
    @InjectRepository(StockIssueLine)
    private readonly lineRepo: Repository<StockIssueLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly stockService: StockService,
    private readonly productsService: ProductsService,
    private readonly sequenceService: SequenceService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  findAll(tenantId: string, query: StockIssueQueryDto = {}): Promise<StockIssue[]> {
    const where: Record<string, unknown> = { tenantId };
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    return this.issueRepo.find({ where, relations: ['lines'], order: { date: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<StockIssue> {
    const issue = await this.issueRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!issue) throw new NotFoundException('Stock issue not found');
    return issue;
  }

  async create(tenantId: string, userId: string, dto: CreateStockIssueDto): Promise<StockIssue> {
    const warehouse = await this.warehouseRepo.findOne({ where: { id: dto.warehouseId, tenantId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    if (dto.expenseAccountId) await this.assertAccount(tenantId, dto.expenseAccountId);

    const lines: Partial<StockIssueLine>[] = [];
    for (const l of dto.lines) {
      const product = await this.productRepo.findOne({ where: { id: l.productId, tenantId } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.type === ProductType.SERVICE) {
        throw new BadRequestException(`Service ${product.code} cannot be issued from stock`);
      }
      const quantity = await this.productsService.toBaseQuantity(tenantId, l.productId, l.quantity, l.unitId);
      if (!(quantity > 0)) throw new BadRequestException('Issued quantity must be positive');
      if (l.lots?.length) {
        const lotQty = round(l.lots.reduce((s, x) => s + Number(x.quantity), 0), 4);
        if (Math.abs(lotQty - quantity) > 0.0001) {
          throw new BadRequestException(`Lot quantities of ${product.code} must add up to ${quantity}`);
        }
      }
      lines.push({
        productId: l.productId,
        quantity,
        unitId: l.unitId ?? null,
        enteredQuantity: l.unitId ? Number(l.quantity) : null,
        requestedLots: l.lots?.length
          ? l.lots.map((x) => ({ lotNumber: x.lotNumber, quantity: Number(x.quantity), expiryDate: x.expiryDate ?? null }))
          : null,
        issuedLots: [],
        unitCost: 0,
        cost: 0,
        notes: l.notes ?? null,
      });
    }

    const issue = await this.issueRepo.save(
      this.issueRepo.create({
        tenantId,
        issueNumber: await this.sequenceService.next(tenantId, 'stock_issue', 'ISS'),
        type: dto.type,
        date: dto.date || today(),
        warehouseId: dto.warehouseId,
        reason: dto.reason ?? null,
        beneficiary: dto.beneficiary ?? null,
        expenseAccountId: dto.expenseAccountId ?? null,
        status: StockIssueStatus.DRAFT,
        totalCost: 0,
        createdBy: userId,
        lines: lines.map((l) => this.lineRepo.create(l)),
      }),
    );
    if (dto.post) return this.post(tenantId, userId, issue.id);
    return this.findById(tenantId, issue.id);
  }

  async post(tenantId: string, userId: string, id: string): Promise<StockIssue> {
    const issue = await this.findById(tenantId, id);
    if (issue.status !== StockIssueStatus.DRAFT) {
      throw new ConflictException('Only draft stock issues can be posted');
    }
    const expenseKey = issue.expenseAccountId ? null : STOCK_ISSUE_ACCOUNT[issue.type];
    await this.autoPosting.preflight(
      tenantId,
      issue.date,
      expenseKey ? ['inventoryAccountId', expenseKey] : ['inventoryAccountId'],
    );

    const label = `${issue.issueNumber} (${issue.type})${issue.reason ? ` - ${issue.reason}` : ''}`;
    let total = 0;
    for (const line of issue.lines) {
      const issued = await this.stockService.issue(
        tenantId,
        userId,
        {
          productId: line.productId,
          warehouseId: issue.warehouseId,
          quantity: Number(line.quantity),
          referenceType: 'stock_issue',
          referenceId: issue.id,
          description: `Stock issue ${label}`,
          lots: line.requestedLots ?? undefined,
        },
        // Damaged goods are often expired: FEFO may then pick expired lots.
        { movementType: StockMovementType.OUT, includeExpiredLots: issue.type === StockIssueType.DAMAGE },
      );
      line.unitCost = issued.unitCost;
      line.cost = issued.cost;
      line.issuedLots = issued.lots;
      total = round(total + issued.cost, 4);
    }
    await this.lineRepo.save(issue.lines);

    if (total > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: issue.date,
        description: `Stock issue ${label}`,
        sourceType: 'stock_issue',
        sourceId: issue.id,
        buildLines: (_s, account) => [
          { accountId: expenseKey ? account(expenseKey) : issue.expenseAccountId!, debit: total },
          { accountId: account('inventoryAccountId'), credit: total },
        ],
      });
    }

    issue.status = StockIssueStatus.POSTED;
    issue.totalCost = total;
    issue.postedAt = new Date();
    const { lines: _l, warehouse: _w, ...header } = issue;
    await this.issueRepo.save(header as StockIssue);
    return this.findById(tenantId, id);
  }

  /** Cancels a draft, or returns the goods of a posted issue and reverses its entry. */
  async cancel(tenantId: string, userId: string, id: string): Promise<StockIssue> {
    const issue = await this.findById(tenantId, id);
    if (issue.status === StockIssueStatus.CANCELLED) {
      throw new ConflictException('The stock issue is already cancelled');
    }
    if (issue.status === StockIssueStatus.POSTED) {
      for (const line of issue.lines) {
        await this.stockService.receive(
          tenantId,
          userId,
          {
            productId: line.productId,
            warehouseId: issue.warehouseId,
            quantity: Number(line.quantity),
            unitCost: Number(line.unitCost),
            referenceType: 'stock_issue',
            referenceId: issue.id,
            description: `Cancel stock issue ${issue.issueNumber}`,
          },
          {
            movementType: StockMovementType.IN,
            lotAllocations: line.issuedLots?.length
              ? line.issuedLots.map((l) => ({ ...l, expiryDate: l.expiryDate ?? null }))
              : undefined,
          },
        );
      }
      await this.autoPosting.reverseSource(tenantId, userId, 'stock_issue', issue.id);
    }
    issue.status = StockIssueStatus.CANCELLED;
    const { lines: _l, warehouse: _w, ...header } = issue;
    await this.issueRepo.save(header as StockIssue);
    return this.findById(tenantId, id);
  }

  private async assertAccount(tenantId: string, id: string) {
    const account = await this.accountRepo.findOne({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Expense account not found');
    if (!account.isActive || !account.allowPosting) {
      throw new BadRequestException(`Account ${account.code} does not allow posting`);
    }
  }
}
