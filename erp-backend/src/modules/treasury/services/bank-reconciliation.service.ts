import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import {
  BankReconciliationMatch,
  BankStatement,
  BankStatementLine,
  BankStatementStatus,
} from '../entities/bank-statement.entity';
import { Treasury, TreasuryType } from '../entities/treasury.entity';
import { VoucherType } from '../entities/treasury-voucher.entity';
import {
  AutoMatchDto,
  ImportStatementDto,
  ManualMatchDto,
  StatementLineDto,
  StatementLineVoucherDto,
} from '../dto/treasury.dto';
import { AccountingSettingsService } from '@modules/accounting/services/accounting-settings.service';
import { round } from '@shared/utils/document-totals.util';
import { TreasuriesService } from './treasuries.service';
import { LedgerLine, TreasuryLedgerService } from './treasury-ledger.service';
import { VOUCHER_SOURCE, VouchersService } from './vouchers.service';
import { Mt940Error, Mt940Statement, parseMt940 } from './mt940.parser';

const AMOUNT_TOLERANCE = 0.005;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
}

function normalise(text?: string | null): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
}

/** Splits one CSV row on `delimiter`, honouring double quotes. */
function splitCsvRow(row: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (quoted) {
      if (ch === '"' && row[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

/** Parses "1,234.50" / "-12.5"; commas are thousands separators. */
function parseNumber(value?: string): number {
  if (!value) return 0;
  const n = Number(value.replace(/,/g, '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Bank statements and reconciliation: statement lines are matched with
 * posted journal lines on the bank treasury's GL account (matches are kept
 * in bank_reconciliation_matches), automatically by amount/date/reference
 * or manually; unmatched bank items (charges, interest) become vouchers.
 */
@Injectable()
export class BankReconciliationService {
  constructor(
    @InjectRepository(BankStatement)
    private readonly statementRepo: Repository<BankStatement>,
    @InjectRepository(BankStatementLine)
    private readonly lineRepo: Repository<BankStatementLine>,
    @InjectRepository(BankReconciliationMatch)
    private readonly matchRepo: Repository<BankReconciliationMatch>,
    private readonly treasuries: TreasuriesService,
    private readonly ledger: TreasuryLedgerService,
    private readonly vouchers: VouchersService,
    private readonly settingsService: AccountingSettingsService,
  ) {}

  /** Parses CSV with header: date, description, reference, amount | debit/credit. */
  static parseCsv(csv: string): StatementLineDto[] {
    const rows = csv
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (rows.length < 2) throw new BadRequestException('CSV needs a header row and lines');
    const delimiter = rows[0].includes(';') ? ';' : rows[0].includes('\t') ? '\t' : ',';
    const header = splitCsvRow(rows[0], delimiter).map((h) => h.toLowerCase());
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const iDate = col('date', 'value date', 'transaction date', 'التاريخ');
    const iDesc = col('description', 'details', 'narrative', 'البيان');
    const iRef = col('reference', 'ref', 'cheque', 'المرجع');
    const iAmount = col('amount', 'المبلغ');
    const iOut = col('debit', 'withdrawal', 'withdrawals', 'مدين');
    const iIn = col('credit', 'deposit', 'deposits', 'دائن');
    if (iDate < 0 || (iAmount < 0 && iIn < 0 && iOut < 0)) {
      throw new BadRequestException('CSV header must have date and amount (or debit/credit) columns');
    }
    return rows.slice(1).map((row, index) => {
      const cells = splitCsvRow(row, delimiter);
      const date = cells[iDate];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
        throw new BadRequestException(`CSV line ${index + 2}: date must be YYYY-MM-DD`);
      }
      const amount =
        iAmount >= 0
          ? parseNumber(cells[iAmount])
          : round(parseNumber(cells[iIn]) - parseNumber(cells[iOut]), 4);
      return {
        date,
        description: iDesc >= 0 ? cells[iDesc] : undefined,
        reference: iRef >= 0 ? cells[iRef] || undefined : undefined,
        amount,
      };
    });
  }

  /**
   * Pairs statement lines with ledger lines of the same amount within
   * `dayTolerance` days, preferring a matching reference, then the closest
   * date. Each ledger line is used once. Returns [statementLineId, ledger line].
   */
  static findMatches(
    statementLines: Pick<BankStatementLine, 'id' | 'date' | 'amount' | 'reference' | 'description'>[],
    ledgerLines: LedgerLine[],
    dayTolerance = 7,
  ): [string, LedgerLine][] {
    const used = new Set<string>();
    const result: [string, LedgerLine][] = [];
    for (const line of statementLines) {
      const amount = Number(line.amount);
      const ref = normalise(line.reference);
      const text = normalise(`${line.reference ?? ''}${line.description ?? ''}`);
      let best: { l: LedgerLine; score: number } | null = null;
      for (const l of ledgerLines) {
        if (used.has(l.journalLineId)) continue;
        if (Math.abs(l.amount - amount) > AMOUNT_TOLERANCE) continue;
        const days = daysBetween(l.date, line.date);
        if (days > dayTolerance) continue;
        const ledgerText = normalise(`${l.refNumber}${l.description ?? ''}`);
        const refMatch =
          (ref.length >= 3 && ledgerText.includes(ref)) ||
          (normalise(l.refNumber).length >= 3 && text.includes(normalise(l.refNumber)));
        const score = (refMatch ? 0 : 1000) + days;
        if (!best || score < best.score) best = { l, score };
      }
      if (best) {
        used.add(best.l.journalLineId);
        result.push([line.id, best.l]);
      }
    }
    return result;
  }

  findAll(tenantId: string, treasuryId?: string) {
    const where: any = { tenantId };
    if (treasuryId) where.treasuryId = treasuryId;
    return this.statementRepo.find({ where, order: { endDate: 'DESC', createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string) {
    const statement = await this.getStatement(tenantId, id);
    const matches = statement.lines.length
      ? await this.matchRepo.find({
          where: { tenantId, statementLineId: In(statement.lines.map((l) => l.id)) },
        })
      : [];
    const treasury = await this.treasuries.findById(tenantId, statement.treasuryId);
    const ledgerLines = await this.ledger.lines(tenantId, treasury, {
      journalLineIds: matches.map((m) => m.journalLineId),
    });
    const byId = new Map(ledgerLines.map((l) => [l.journalLineId, l]));
    return {
      ...statement,
      lines: statement.lines.map((line) => ({
        ...line,
        matches: matches
          .filter((m) => m.statementLineId === line.id)
          .map((m) => ({ ...m, journalLine: byId.get(m.journalLineId) ?? null })),
      })),
    };
  }

  /** Parses an MT940 statement into statement lines (BadRequest on malformed input). */
  static parseMt940(text: string): { statement: Mt940Statement; lines: StatementLineDto[] } {
    let statement: Mt940Statement;
    try {
      statement = parseMt940(text);
    } catch (err) {
      if (err instanceof Mt940Error) throw new BadRequestException(`MT940: ${err.message}`);
      throw err;
    }
    return {
      statement,
      lines: statement.lines.map((l) => ({
        date: l.date,
        amount: l.amount,
        reference: l.reference ?? l.bankReference,
        description: [l.transactionType, l.description].filter(Boolean).join(' ') || undefined,
      })),
    };
  }

  async import(tenantId: string, userId: string, dto: ImportStatementDto) {
    const treasury = await this.treasuries.getActive(tenantId, dto.treasuryId, TreasuryType.BANK);
    const mt940 = dto.mt940 ? BankReconciliationService.parseMt940(dto.mt940) : null;
    const lines = [
      ...(dto.lines ?? []),
      ...(dto.csv ? BankReconciliationService.parseCsv(dto.csv) : []),
      ...(mt940?.lines ?? []),
    ];
    if (!lines.length) throw new BadRequestException('The statement has no lines');
    const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
    if (mt940) {
      dto = {
        ...dto,
        reference:
          dto.reference ?? mt940.statement.statementNumber ?? mt940.statement.transactionReference ?? undefined,
        openingBalance: dto.openingBalance ?? mt940.statement.opening?.amount,
        closingBalance: dto.closingBalance ?? mt940.statement.closing?.amount,
        startDate: dto.startDate ?? mt940.statement.opening?.date,
        endDate: dto.endDate ?? mt940.statement.closing?.date,
      };
    }
    const openingBalance = round(dto.openingBalance ?? 0, 4);
    const movement = round(
      lines.reduce((s, l) => s + Number(l.amount), 0),
      4,
    );
    const closingBalance = round(dto.closingBalance ?? openingBalance + movement, 4);
    if (Math.abs(round(openingBalance + movement - closingBalance, 4)) > 0.01) {
      throw new BadRequestException(
        `Opening ${openingBalance} + lines ${movement} does not equal closing ${closingBalance}`,
      );
    }

    const statement = await this.statementRepo.save(
      this.statementRepo.create({
        tenantId,
        treasuryId: treasury.id,
        reference: dto.reference,
        startDate: dto.startDate ?? sorted[0].date,
        endDate: dto.endDate ?? sorted[sorted.length - 1].date,
        openingBalance,
        closingBalance,
        status: BankStatementStatus.OPEN,
        createdBy: userId,
        lines: sorted.map((l) =>
          this.lineRepo.create({
            date: l.date,
            description: l.description,
            reference: l.reference,
            amount: round(l.amount, 4),
            isMatched: false,
          }),
        ),
      }),
    );
    return this.findById(tenantId, statement.id);
  }

  async autoMatch(tenantId: string, id: string, dto: AutoMatchDto = {}) {
    const statement = await this.getOpenStatement(tenantId, id);
    const treasury = await this.treasuries.findById(tenantId, statement.treasuryId);
    const tolerance = dto.dayTolerance ?? 7;
    const shift = (date: string, days: number) => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const ledgerLines = await this.ledger.lines(tenantId, treasury, {
      from: shift(statement.startDate, -tolerance),
      to: shift(statement.endDate, tolerance),
      unreconciled: true,
    });
    const pairs = BankReconciliationService.findMatches(
      statement.lines.filter((l) => !l.isMatched),
      ledgerLines,
      tolerance,
    );
    for (const [statementLineId, ledgerLine] of pairs) {
      await this.saveMatches(tenantId, treasury, statementLineId, [ledgerLine], 'auto');
    }
    return { matched: pairs.length, statement: await this.findById(tenantId, id) };
  }

  /** Matches a statement line with one or several ledger lines summing to its amount. */
  async match(tenantId: string, lineId: string, dto: ManualMatchDto) {
    const { line, statement } = await this.getLine(tenantId, lineId);
    if (line.isMatched) throw new ConflictException('Statement line is already matched');
    const treasury = await this.treasuries.findById(tenantId, statement.treasuryId);
    const ids = [...new Set(dto.journalLineIds)];
    const ledgerLines = await this.ledger.lines(tenantId, treasury, { journalLineIds: ids });
    if (ledgerLines.length !== ids.length) {
      throw new BadRequestException(
        'Journal lines must be posted lines on the account of this bank treasury',
      );
    }
    const taken = ledgerLines.find((l) => l.statementLineId);
    if (taken) throw new ConflictException(`Journal line ${taken.journalLineId} is already reconciled`);
    const total = round(
      ledgerLines.reduce((s, l) => s + l.amount, 0),
      4,
    );
    if (Math.abs(total - Number(line.amount)) > 0.01) {
      throw new BadRequestException(
        `Journal lines total ${total} does not equal the statement line amount ${Number(line.amount)}`,
      );
    }
    await this.saveMatches(tenantId, treasury, line.id, ledgerLines, 'manual');
    return this.findById(tenantId, statement.id);
  }

  async unmatch(tenantId: string, lineId: string) {
    const { line, statement } = await this.getLine(tenantId, lineId);
    await this.matchRepo.delete({ tenantId, statementLineId: line.id });
    await this.lineRepo.update(line.id, { isMatched: false });
    return this.findById(tenantId, statement.id);
  }

  /**
   * Books an unmatched bank item (charges, interest, direct debit...) as a
   * posted voucher on the treasury and matches it with the line.
   */
  async createVoucher(
    tenantId: string,
    userId: string,
    lineId: string,
    dto: StatementLineVoucherDto,
  ) {
    const { line, statement } = await this.getLine(tenantId, lineId);
    if (line.isMatched) throw new ConflictException('Statement line is already matched');
    const amount = Number(line.amount);
    const outflow = amount < 0;
    let accountId = dto.accountId;
    if (!accountId) {
      if (!outflow) throw new BadRequestException('accountId is required for deposits');
      const settings = await this.settingsService.find(tenantId);
      accountId = settings?.bankChargesAccountId;
      if (!accountId) throw new BadRequestException('accountId is required (no bank charges account)');
    }
    const description = dto.description ?? line.description ?? 'Bank statement item';
    const voucher = await this.vouchers.create(
      tenantId,
      userId,
      {
        type: outflow ? VoucherType.PAYMENT : VoucherType.RECEIPT,
        treasuryId: statement.treasuryId,
        date: line.date,
        reference: line.reference,
        description,
        lines: [
          { accountId, amount: Math.abs(amount), description, costCenterId: dto.costCenterId },
        ],
        post: true,
      },
      { statementLineId: line.id },
    );

    const treasury = await this.treasuries.findById(tenantId, statement.treasuryId);
    const ledgerLines = (await this.ledger.lines(tenantId, treasury, { from: line.date, to: line.date })).filter(
      (l) => l.sourceType === VOUCHER_SOURCE && l.sourceId === voucher.id,
    );
    if (!ledgerLines.length) {
      throw new ConflictException(
        'The voucher produced no journal entry (automatic accounting is disabled); nothing to match',
      );
    }
    await this.saveMatches(tenantId, treasury, line.id, ledgerLines, 'manual');
    return { voucher, statement: await this.findById(tenantId, statement.id) };
  }

  /**
   * Bank reconciliation report as of the statement end date:
   * book balance + unmatched bank items = bank balance + outstanding book items.
   * Outstanding book items are unreconciled ledger lines since the first
   * statement of the treasury (deposits in transit, unpresented payments).
   */
  async report(tenantId: string, id: string) {
    const statement = await this.getStatement(tenantId, id);
    const treasury = await this.treasuries.findById(tenantId, statement.treasuryId);
    const first = await this.statementRepo.findOne({
      where: { tenantId, treasuryId: treasury.id },
      order: { startDate: 'ASC' },
    });
    const since = first?.startDate ?? statement.startDate;

    const book = await this.ledger.balance(tenantId, treasury, { asOf: statement.endDate });
    const bookBeforeStart = await this.ledger.balance(tenantId, treasury, { before: since });
    const outstanding = await this.ledger.lines(tenantId, treasury, {
      from: since,
      to: statement.endDate,
      unreconciled: true,
    });
    const statementIds = (
      await this.statementRepo.find({
        where: { tenantId, treasuryId: treasury.id, startDate: LessThanOrEqual(statement.endDate) },
        select: ['id'],
      })
    ).map((s) => s.id);
    const unmatchedBank = statementIds.length
      ? await this.lineRepo.find({
          where: {
            statementId: In(statementIds),
            isMatched: false,
            date: LessThanOrEqual(statement.endDate),
          },
          order: { date: 'ASC' },
        })
      : [];

    const depositsInTransit = outstanding.filter((l) => l.amount > 0);
    const outstandingPayments = outstanding.filter((l) => l.amount < 0);
    const sum = (xs: { amount: number | string }[]) =>
      round(
        xs.reduce((s, x) => s + Number(x.amount), 0),
        4,
      );
    const statementBalance = Number(statement.closingBalance);
    const adjustedBankBalance = round(statementBalance + sum(outstanding), 4);
    const adjustedBookBalance = round(book.balance + sum(unmatchedBank), 4);
    const difference = round(adjustedBookBalance - adjustedBankBalance, 4);

    return {
      statement: {
        id: statement.id,
        reference: statement.reference,
        startDate: statement.startDate,
        endDate: statement.endDate,
        openingBalance: Number(statement.openingBalance),
        closingBalance: statementBalance,
        status: statement.status,
        lines: statement.lines.length,
        matchedLines: statement.lines.filter((l) => l.isMatched).length,
      },
      treasury: { id: treasury.id, code: treasury.code, nameAr: treasury.nameAr },
      reconciliationStart: since,
      /** Book balance before the first statement; should equal that statement's opening balance. */
      bookBalanceBeforeStart: bookBeforeStart.balance,
      firstStatementOpeningBalance: first ? Number(first.openingBalance) : null,
      bookBalance: book.balance,
      statementBalance,
      depositsInTransit,
      totalDepositsInTransit: sum(depositsInTransit),
      outstandingPayments,
      totalOutstandingPayments: sum(outstandingPayments),
      unmatchedStatementLines: unmatchedBank,
      totalUnmatchedStatementLines: sum(unmatchedBank),
      adjustedBankBalance,
      adjustedBookBalance,
      difference,
      isReconciled: Math.abs(difference) < 0.01 && unmatchedBank.length === 0,
    };
  }

  /** Closes a statement once every line is matched. */
  async close(tenantId: string, id: string) {
    const statement = await this.getStatement(tenantId, id);
    const open = statement.lines.filter((l) => !l.isMatched).length;
    if (open) throw new ConflictException(`${open} statement line(s) are not matched yet`);
    statement.status = BankStatementStatus.RECONCILED;
    await this.statementRepo.save(statement);
    return this.findById(tenantId, id);
  }

  async reopen(tenantId: string, id: string) {
    const statement = await this.getStatement(tenantId, id);
    statement.status = BankStatementStatus.OPEN;
    await this.statementRepo.save(statement);
    return this.findById(tenantId, id);
  }

  /** Deletes an open statement that has no matches yet. */
  async remove(tenantId: string, id: string) {
    const statement = await this.getOpenStatement(tenantId, id);
    if (statement.lines.some((l) => l.isMatched)) {
      throw new ConflictException('Unmatch the statement lines first');
    }
    await this.lineRepo.delete({ statementId: statement.id });
    await this.statementRepo.delete({ id: statement.id, tenantId });
    return { deleted: true };
  }

  private async saveMatches(
    tenantId: string,
    treasury: Treasury,
    statementLineId: string,
    lines: LedgerLine[],
    matchType: 'auto' | 'manual',
  ) {
    await this.matchRepo.save(
      lines.map((l) =>
        this.matchRepo.create({
          tenantId,
          statementLineId,
          journalLineId: l.journalLineId,
          treasuryId: treasury.id,
          amount: l.amount,
          matchType,
        }),
      ),
    );
    await this.lineRepo.update(statementLineId, { isMatched: true });
  }

  private async getStatement(tenantId: string, id: string): Promise<BankStatement> {
    const statement = await this.statementRepo.findOne({
      where: { id, tenantId },
      relations: ['lines'],
    });
    if (!statement) throw new NotFoundException('Bank statement not found');
    statement.lines.sort((a, b) => a.date.localeCompare(b.date));
    return statement;
  }

  private async getOpenStatement(tenantId: string, id: string): Promise<BankStatement> {
    const statement = await this.getStatement(tenantId, id);
    if (statement.status !== BankStatementStatus.OPEN) {
      throw new ConflictException('Statement is closed; reopen it first');
    }
    return statement;
  }

  private async getLine(tenantId: string, lineId: string) {
    const line = await this.lineRepo.findOne({ where: { id: lineId }, relations: ['statement'] });
    if (!line || line.statement.tenantId !== tenantId) {
      throw new NotFoundException('Statement line not found');
    }
    const statement = line.statement;
    if (statement.status !== BankStatementStatus.OPEN) {
      throw new ConflictException('Statement is closed; reopen it first');
    }
    return { line, statement };
  }
}
