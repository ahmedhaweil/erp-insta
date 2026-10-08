import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import {
  TreasuryVoucher,
  TreasuryVoucherLine,
  VoucherStatus,
  VoucherType,
} from '../entities/treasury-voucher.entity';
import { Treasury, TreasuryType } from '../entities/treasury.entity';
import {
  CancelDto,
  CreateVoucherDto,
  UpdateVoucherDto,
  VoucherLineDto,
  VoucherQueryDto,
} from '../dto/treasury.dto';
import { AutoPostingService, PostingLine } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';
import { TreasuriesService } from './treasuries.service';
import { TreasuryLedgerService } from './treasury-ledger.service';
import { ApprovalsService } from '@modules/approvals/services/approvals.service';
import { ApprovalDocumentType } from '@modules/approvals/entities/approval-rule.entity';

export const VOUCHER_SOURCE = 'treasury_voucher';

/**
 * Receipt (سند قبض) and payment (سند صرف) vouchers: money in or out of a
 * treasury against any GL account, with cost center / branch per line.
 * Draft -> posted -> cancelled (posted vouchers are reversed).
 */
@Injectable()
export class VouchersService implements OnModuleInit {
  constructor(
    @InjectRepository(TreasuryVoucher)
    private readonly voucherRepo: Repository<TreasuryVoucher>,
    @InjectRepository(TreasuryVoucherLine)
    private readonly lineRepo: Repository<TreasuryVoucherLine>,
    private readonly treasuries: TreasuriesService,
    private readonly ledger: TreasuryLedgerService,
    private readonly autoPosting: AutoPostingService,
    private readonly sequenceService: SequenceService,
    @Optional() private readonly approvals?: ApprovalsService,
  ) {}

  /** Approval engine: the last approver posts the payment voucher. */
  onModuleInit(): void {
    this.approvals?.registerHandler(ApprovalDocumentType.TREASURY_VOUCHER, {
      onApproved: async (request, userId) => {
        if (!request.documentId) return;
        const voucher = await this.findById(request.tenantId, request.documentId);
        if (voucher.status !== VoucherStatus.DRAFT) return;
        await this.approvals!.markExecuted(request);
        await this.post(request.tenantId, userId, voucher.id);
      },
    });
  }

  findAll(tenantId: string, query: VoucherQueryDto = {}) {
    const where: any = { tenantId };
    if (query.type) where.type = query.type;
    if (query.treasuryId) where.treasuryId = query.treasuryId;
    if (query.from && query.to) where.date = Between(query.from, query.to);
    else if (query.from) where.date = MoreThanOrEqual(query.from);
    else if (query.to) where.date = LessThanOrEqual(query.to);
    return this.voucherRepo.find({
      where,
      relations: ['lines'],
      order: { date: 'DESC', createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<TreasuryVoucher> {
    const voucher = await this.voucherRepo.findOne({
      where: { id, tenantId },
      relations: ['lines'],
    });
    if (!voucher) throw new NotFoundException('Voucher not found');
    return voucher;
  }

  async create(
    tenantId: string,
    userId: string,
    dto: CreateVoucherDto,
    extra: { statementLineId?: string } = {},
  ): Promise<TreasuryVoucher> {
    const treasury = await this.treasuries.getActive(tenantId, dto.treasuryId);
    const exchangeRate = this.rateFor(treasury, dto.exchangeRate);
    const lines = this.buildLines(dto.lines, dto.branchId ?? treasury.branchId);

    const voucherNumber = await this.sequenceService.next(
      tenantId,
      dto.type === VoucherType.RECEIPT ? 'treasury_receipt' : 'treasury_payment',
      dto.type === VoucherType.RECEIPT ? 'RV' : 'PV',
    );
    const voucher = await this.voucherRepo.save(
      this.voucherRepo.create({
        tenantId,
        voucherNumber,
        type: dto.type,
        date: dto.date,
        treasuryId: treasury.id,
        status: VoucherStatus.DRAFT,
        amount: this.total(lines),
        currencyId: treasury.currencyId,
        exchangeRate,
        counterpartyName: dto.counterpartyName,
        reference: dto.reference,
        description: dto.description,
        branchId: dto.branchId ?? treasury.branchId,
        statementLineId: extra.statementLineId,
        createdBy: userId,
        lines,
      }),
    );
    return dto.post ? this.post(tenantId, userId, voucher.id) : this.findById(tenantId, voucher.id);
  }

  async update(tenantId: string, id: string, dto: UpdateVoucherDto): Promise<TreasuryVoucher> {
    const voucher = await this.findById(tenantId, id);
    if (voucher.status !== VoucherStatus.DRAFT) {
      throw new ConflictException('Only draft vouchers can be edited');
    }
    const treasury = await this.treasuries.getActive(
      tenantId,
      dto.treasuryId ?? voucher.treasuryId,
    );
    const { lines: lineDtos, ...header } = dto;
    Object.assign(voucher, header, {
      treasuryId: treasury.id,
      currencyId: treasury.currencyId,
      exchangeRate: this.rateFor(treasury, dto.exchangeRate ?? Number(voucher.exchangeRate)),
    });
    if (lineDtos) {
      await this.lineRepo.delete({ voucherId: voucher.id });
      voucher.lines = this.buildLines(lineDtos, voucher.branchId);
      voucher.amount = this.total(voucher.lines);
    }
    await this.voucherRepo.save(voucher);
    return this.findById(tenantId, id);
  }

  async post(tenantId: string, userId: string, id: string): Promise<TreasuryVoucher> {
    const voucher = await this.findById(tenantId, id);
    if (voucher.status !== VoucherStatus.DRAFT) {
      throw new ConflictException('Only draft vouchers can be posted');
    }
    const treasury = await this.treasuries.getActive(tenantId, voucher.treasuryId);
    await this.autoPosting.preflight(tenantId, voucher.date, []);

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: treasury.type === TreasuryType.CASH ? JournalType.CASH : JournalType.BANK,
      date: voucher.date,
      description: `${voucher.type === VoucherType.RECEIPT ? 'Receipt' : 'Payment'} voucher ${
        voucher.voucherNumber
      }${voucher.description ? ` - ${voucher.description}` : ''}`,
      sourceType: VOUCHER_SOURCE,
      sourceId: voucher.id,
      currencyId: voucher.currencyId,
      exchangeRate: Number(voucher.exchangeRate) || 1,
      buildLines: () => VouchersService.postingLines(voucher, treasury),
    });

    voucher.status = VoucherStatus.POSTED;
    voucher.postedAt = new Date();
    await this.voucherRepo.save(voucher);
    return voucher;
  }

  async cancel(
    tenantId: string,
    userId: string,
    id: string,
    dto: CancelDto = {},
  ): Promise<TreasuryVoucher> {
    const voucher = await this.findById(tenantId, id);
    if (voucher.status === VoucherStatus.CANCELLED) {
      throw new ConflictException('Voucher is already cancelled');
    }
    if (voucher.status === VoucherStatus.POSTED) {
      await this.ledger.assertNotReconciled(tenantId, VOUCHER_SOURCE, voucher.id);
      await this.autoPosting.reverseSource(tenantId, userId, VOUCHER_SOURCE, voucher.id, dto.date);
    }
    voucher.status = VoucherStatus.CANCELLED;
    await this.voucherRepo.save(voucher);
    return voucher;
  }

  /**
   * Receipt: Dr treasury (total) / Cr each line account.
   * Payment: Dr each line account / Cr treasury (total).
   */
  static postingLines(voucher: TreasuryVoucher, treasury: Treasury): PostingLine[] {
    const total = round(
      voucher.lines.reduce((s, l) => s + Number(l.amount), 0),
      4,
    );
    const receipt = voucher.type === VoucherType.RECEIPT;
    const treasuryLine: PostingLine = {
      accountId: treasury.accountId,
      [receipt ? 'debit' : 'credit']: total,
      branchId: treasury.branchId ?? voucher.branchId ?? undefined,
      description: voucher.description ?? undefined,
    };
    const counterparts: PostingLine[] = voucher.lines.map((l) => ({
      accountId: l.accountId,
      [receipt ? 'credit' : 'debit']: Number(l.amount),
      costCenterId: l.costCenterId ?? undefined,
      branchId: l.branchId ?? voucher.branchId ?? undefined,
      description: l.description ?? voucher.description ?? undefined,
    }));
    return receipt ? [treasuryLine, ...counterparts] : [...counterparts, treasuryLine];
  }

  private rateFor(treasury: Treasury, rate?: number): number {
    const value = Number(rate ?? 1);
    if (!treasury.currencyId && value !== 1) {
      throw new BadRequestException(
        `Treasury ${treasury.code} is in the base currency; the exchange rate must be 1`,
      );
    }
    return value;
  }

  private buildLines(lines: VoucherLineDto[], branchId?: string): TreasuryVoucherLine[] {
    if (!lines?.length) throw new BadRequestException('A voucher needs at least one line');
    return lines.map((l) => {
      if (!(Number(l.amount) > 0)) throw new BadRequestException('Line amounts must be positive');
      return this.lineRepo.create({
        accountId: l.accountId,
        amount: round(l.amount, 4),
        description: l.description,
        costCenterId: l.costCenterId,
        branchId: l.branchId ?? branchId,
      });
    });
  }

  private total(lines: TreasuryVoucherLine[]): number {
    return round(
      lines.reduce((s, l) => s + Number(l.amount), 0),
      4,
    );
  }
}
