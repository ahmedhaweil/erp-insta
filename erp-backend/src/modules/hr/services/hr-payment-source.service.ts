import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Treasury, TreasuryType } from '@modules/treasury/entities/treasury.entity';
import { enforceTreasuryRules } from '@modules/treasury/services/treasury-access.util';
import { RbacService } from '@modules/auth/services/rbac.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { HrPaymentMethod } from '../entities/employee-loan.entity';

export interface HrPaymentSource {
  journalType: JournalType;
  /** Settings key of the default cash/bank account, when no treasury is chosen. */
  settingsKey?: SettingsAccountKey;
  /** GL account of the chosen treasury. */
  accountId?: string;
  treasuryId?: string;
}

/**
 * Where money paid to employees (salaries, loans, final settlements) comes
 * from: a chosen cash box / bank account (treasury), subject to the treasury
 * rules (custodians, no negative cash), or the default cash/bank account of
 * the accounting settings for the payment method.
 */
@Injectable()
export class HrPaymentSourceService {
  constructor(
    @InjectRepository(Treasury)
    private readonly treasuryRepo: Repository<Treasury>,
    @Optional() private readonly rbac?: RbacService,
  ) {}

  async resolve(
    tenantId: string,
    userId: string,
    dto: { paymentMethod: HrPaymentMethod; treasuryId?: string; date: string },
    amount: number,
  ): Promise<HrPaymentSource> {
    if (!dto.treasuryId) {
      const cash = dto.paymentMethod === HrPaymentMethod.CASH;
      return {
        journalType: cash ? JournalType.CASH : JournalType.BANK,
        settingsKey: cash ? 'cashAccountId' : 'bankAccountId',
      };
    }
    const treasury = await this.treasuryRepo.findOne({ where: { id: dto.treasuryId, tenantId } });
    if (!treasury || treasury.isActive === false) throw new NotFoundException('Treasury not found');
    if (treasury.currencyId) {
      // Payroll and employee loans are in the base currency.
      throw new BadRequestException(`Treasury ${treasury.code} is in a foreign currency; pay employees from a base-currency treasury`);
    }
    await enforceTreasuryRules({
      tenantId,
      userId,
      treasury,
      rbac: this.rbac,
      query: (sql, params) => this.treasuryRepo.query(sql, params),
      outflow: amount,
      date: dto.date,
    });
    return {
      journalType: treasury.type === TreasuryType.CASH ? JournalType.CASH : JournalType.BANK,
      accountId: treasury.accountId,
      treasuryId: treasury.id,
    };
  }

  /** The credit account of the payment inside a buildLines callback. */
  static account(source: HrPaymentSource, account: (key: SettingsAccountKey) => string): string {
    return source.accountId ?? account(source.settingsKey!);
  }
}
