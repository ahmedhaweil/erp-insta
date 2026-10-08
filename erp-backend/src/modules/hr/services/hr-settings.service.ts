import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HrSettings } from '../entities/hr-settings.entity';
import { DeepPartial, PayrollRules, mergeRules } from '../calculators/payroll-rules';
import { PayrollCalculator } from '../calculators/payroll-calculator';
import { Account } from '@modules/accounting/entities/account.entity';

export interface HrAccounts {
  eosExpenseAccountId: string | null;
  eosProvisionAccountId: string | null;
  martyrsFundAccountId: string | null;
}

@Injectable()
export class HrSettingsService {
  constructor(
    @InjectRepository(HrSettings)
    private readonly settingsRepo: Repository<HrSettings>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
  ) {}

  /** Effective rules: defaults merged with the tenant's overrides. */
  async getRules(tenantId: string): Promise<PayrollRules> {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    return mergeRules(settings?.rules);
  }

  async getCalculator(tenantId: string): Promise<PayrollCalculator> {
    return new PayrollCalculator(await this.getRules(tenantId));
  }

  /** HR GL accounts (EOS expense / provision, Martyrs fund payable). */
  async getAccounts(tenantId: string): Promise<HrAccounts> {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    return {
      eosExpenseAccountId: settings?.eosExpenseAccountId ?? null,
      eosProvisionAccountId: settings?.eosProvisionAccountId ?? null,
      martyrsFundAccountId: settings?.martyrsFundAccountId ?? null,
    };
  }

  async get(tenantId: string) {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    return {
      overrides: settings?.rules ?? {},
      effective: mergeRules(settings?.rules),
      accounts: await this.getAccounts(tenantId),
    };
  }

  /**
   * Replaces the tenant rule overrides when `rules` is given (send {} to go
   * back to the defaults) and sets the HR accounts that are given.
   */
  async update(tenantId: string, dto: { rules?: DeepPartial<PayrollRules> } & Partial<HrAccounts>) {
    let settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!settings) settings = this.settingsRepo.create({ tenantId, rules: {} });
    if (dto.rules) {
      this.validate(mergeRules(dto.rules));
      settings.rules = dto.rules;
    }
    for (const key of ['eosExpenseAccountId', 'eosProvisionAccountId', 'martyrsFundAccountId'] as const) {
      if (dto[key] !== undefined) {
        if (dto[key]) await this.assertAccount(tenantId, dto[key] as string, key);
        settings[key] = dto[key] ?? null;
      }
    }
    await this.settingsRepo.save(settings);
    return this.get(tenantId);
  }

  private async assertAccount(tenantId: string, id: string, key: string) {
    const account = await this.accountRepo.findOne({ where: { id, tenantId } });
    if (!account) throw new NotFoundException(`${key}: account not found`);
    if (!account.allowPosting) throw new BadRequestException(`${key}: the account does not allow posting`);
  }

  private validate(rules: PayrollRules) {
    const rates: [string, number][] = [
      ['EG.siEmployeeRate', rules.EG.siEmployeeRate],
      ['EG.siEmployerRate', rules.EG.siEmployerRate],
      ['SA.gosiSaudiEmployeeRate', rules.SA.gosiSaudiEmployeeRate],
      ['SA.gosiSaudiEmployerRate', rules.SA.gosiSaudiEmployerRate],
      ['SA.gosiNonSaudiEmployeeRate', rules.SA.gosiNonSaudiEmployeeRate],
      ['SA.gosiNonSaudiEmployerRate', rules.SA.gosiNonSaudiEmployerRate],
      ...rules.EG.taxBrackets.map((b, i): [string, number] => [`EG.taxBrackets[${i}].rate`, b.rate]),
    ];
    for (const [name, value] of rates) {
      if (typeof value !== 'number' || value < 0 || value > 1) {
        throw new BadRequestException(`${name} must be a fraction between 0 and 1`);
      }
    }
    if (rules.EG.minInsurableWage > rules.EG.maxInsurableWage) {
      throw new BadRequestException('EG.minInsurableWage cannot exceed EG.maxInsurableWage');
    }
    if (rules.SA.minContributoryWage > rules.SA.maxContributoryWage) {
      throw new BadRequestException('SA.minContributoryWage cannot exceed SA.maxContributoryWage');
    }
    const brackets = rules.EG.taxBrackets;
    if (!brackets.length || brackets[brackets.length - 1].upTo !== null) {
      throw new BadRequestException('EG.taxBrackets must end with an unbounded bracket (upTo: null)');
    }
    for (let i = 1; i < brackets.length - 1; i++) {
      if ((brackets[i].upTo as number) <= (brackets[i - 1].upTo as number)) {
        throw new BadRequestException('EG.taxBrackets must be in ascending order');
      }
    }
    const fund = rules.EG.martyrsFund;
    if (typeof fund?.rate !== 'number' || fund.rate < 0 || fund.rate > 0.05) {
      throw new BadRequestException('EG.martyrsFund.rate must be a fraction between 0 and 0.05');
    }
    if (!['employee', 'employer'].includes(fund.bearer)) {
      throw new BadRequestException('EG.martyrsFund.bearer must be employee or employer');
    }
    if (!['auto', 'approved_only'].includes(rules.general.overtimeMode)) {
      throw new BadRequestException('general.overtimeMode must be auto or approved_only');
    }
    if (!(rules.EG.contractualGratuityMonthsPerYear >= 0)) {
      throw new BadRequestException('EG.contractualGratuityMonthsPerYear cannot be negative');
    }
    if (!(rules.general.daysPerMonth > 0)) {
      throw new BadRequestException('general.daysPerMonth must be positive');
    }
  }
}
