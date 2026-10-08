import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Treasury, TreasuryType } from '../entities/treasury.entity';
import { Account, AccountType } from '@modules/accounting/entities/account.entity';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { CreateTreasuryDto, UpdateTreasuryDto } from '../dto/treasury.dto';
import { TreasuryLedgerService } from './treasury-ledger.service';
import { round, today } from '@shared/utils/document-totals.util';

/** Cash boxes and bank accounts, their balances and cash book. */
@Injectable()
export class TreasuriesService {
  constructor(
    @InjectRepository(Treasury)
    private readonly treasuryRepo: Repository<Treasury>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly ledger: TreasuryLedgerService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  async findAll(
    tenantId: string,
    filter: { type?: TreasuryType; activeOnly?: boolean; withBalance?: boolean } = {},
  ) {
    const where: any = { tenantId };
    if (filter.type) where.type = filter.type;
    if (filter.activeOnly) where.isActive = true;
    const treasuries = await this.treasuryRepo.find({ where, order: { code: 'ASC' } });
    if (!filter.withBalance) return treasuries;
    return Promise.all(
      treasuries.map(async (t) => ({ ...t, ...(await this.ledger.balance(tenantId, t)) })),
    );
  }

  async findById(tenantId: string, id: string): Promise<Treasury> {
    const treasury = await this.treasuryRepo.findOne({ where: { id, tenantId } });
    if (!treasury) throw new NotFoundException('Treasury not found');
    return treasury;
  }

  /** Loads an active treasury, optionally of a given type. */
  async getActive(tenantId: string, id: string, type?: TreasuryType): Promise<Treasury> {
    const treasury = await this.findById(tenantId, id);
    if (!treasury.isActive) throw new ConflictException(`Treasury ${treasury.code} is inactive`);
    if (type && treasury.type !== type) {
      throw new BadRequestException(`Treasury ${treasury.code} is not a ${type} treasury`);
    }
    return treasury;
  }

  async getWithBalance(tenantId: string, id: string, asOf?: string) {
    const treasury = await this.findById(tenantId, id);
    return { ...treasury, ...(await this.ledger.balance(tenantId, treasury, { asOf })) };
  }

  async create(tenantId: string, userId: string, dto: CreateTreasuryDto): Promise<Treasury> {
    if (await this.treasuryRepo.findOne({ where: { tenantId, code: dto.code } })) {
      throw new ConflictException(`Treasury code ${dto.code} already exists`);
    }
    await this.assertAccount(tenantId, dto.accountId);
    const clash = await this.treasuryRepo.findOne({
      where: { tenantId, accountId: dto.accountId },
    });
    if (clash) {
      throw new ConflictException(
        `Account is already used by treasury ${clash.code}; each treasury needs its own GL account`,
      );
    }

    const openingBalance = round(dto.openingBalance ?? 0, 4);
    const openingDate = dto.openingDate ?? today();
    const openingRate = Number(dto.openingRate ?? 1);
    if (!dto.currencyId && openingRate !== 1) {
      throw new BadRequestException('Opening rate applies to foreign-currency treasuries only');
    }
    if (openingBalance !== 0) {
      await this.autoPosting.preflight(tenantId, openingDate, ['retainedEarningsAccountId']);
    }

    const treasury = await this.treasuryRepo.save(
      this.treasuryRepo.create({
        ...dto,
        tenantId,
        openingBalance,
        openingDate,
        openingRate,
        isActive: dto.isActive ?? true,
      }),
    );

    if (openingBalance !== 0) {
      const value = Math.abs(openingBalance);
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date: openingDate,
        description: `Opening balance ${treasury.code}`,
        sourceType: 'treasury_opening',
        sourceId: treasury.id,
        currencyId: treasury.currencyId,
        exchangeRate: openingRate,
        buildLines: (_s, account) => {
          const equity = account('retainedEarningsAccountId');
          return openingBalance > 0
            ? [
                { accountId: treasury.accountId, debit: value, branchId: treasury.branchId },
                { accountId: equity, credit: value },
              ]
            : [
                { accountId: equity, debit: value },
                { accountId: treasury.accountId, credit: value, branchId: treasury.branchId },
              ];
        },
      });
    }
    return treasury;
  }

  async update(tenantId: string, id: string, dto: UpdateTreasuryDto): Promise<Treasury> {
    const treasury = await this.findById(tenantId, id);
    if (dto.code && dto.code !== treasury.code) {
      if (await this.treasuryRepo.findOne({ where: { tenantId, code: dto.code } })) {
        throw new ConflictException(`Treasury code ${dto.code} already exists`);
      }
    }
    Object.assign(treasury, dto);
    return this.treasuryRepo.save(treasury);
  }

  /**
   * Cash book / bank movement report: opening balance before `from`, every
   * movement in the range with its running balance, and the closing balance.
   */
  async movements(tenantId: string, id: string, from?: string, to?: string) {
    const treasury = await this.findById(tenantId, id);
    const opening = from
      ? await this.ledger.balance(tenantId, treasury, { before: from })
      : { balance: 0, baseBalance: 0 };
    const lines = await this.ledger.lines(tenantId, treasury, { from, to });

    let running = opening.balance;
    let runningBase = opening.baseBalance;
    let totalIn = 0;
    let totalOut = 0;
    const movements = lines.map((l) => {
      running = round(running + l.amount, 4);
      runningBase = round(runningBase + l.debit - l.credit, 4);
      if (l.amount >= 0) totalIn = round(totalIn + l.amount, 4);
      else totalOut = round(totalOut - l.amount, 4);
      return {
        ...l,
        moneyIn: l.amount > 0 ? l.amount : 0,
        moneyOut: l.amount < 0 ? -l.amount : 0,
        balance: running,
        baseBalance: runningBase,
        reconciled: !!l.statementLineId,
      };
    });

    return {
      treasury: {
        id: treasury.id,
        code: treasury.code,
        nameAr: treasury.nameAr,
        nameEn: treasury.nameEn,
        type: treasury.type,
        currencyId: treasury.currencyId,
      },
      from: from ?? null,
      to: to ?? null,
      openingBalance: opening.balance,
      openingBaseBalance: opening.baseBalance,
      totalIn,
      totalOut,
      closingBalance: running,
      closingBaseBalance: runningBase,
      movements,
    };
  }

  private async assertAccount(tenantId: string, accountId: string): Promise<void> {
    const account = await this.accountRepo.findOne({ where: { id: accountId, tenantId } });
    if (!account) throw new NotFoundException('GL account not found');
    if (account.type !== AccountType.ASSET) {
      throw new BadRequestException('A treasury account must be an asset account');
    }
    if (!account.allowPosting || !account.isActive) {
      throw new BadRequestException('The treasury account must be an active postable account');
    }
  }
}
