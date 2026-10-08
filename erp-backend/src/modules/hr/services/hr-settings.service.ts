import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HrSettings } from '../entities/hr-settings.entity';
import { DeepPartial, PayrollRules, mergeRules } from '../calculators/payroll-rules';
import { PayrollCalculator } from '../calculators/payroll-calculator';

@Injectable()
export class HrSettingsService {
  constructor(
    @InjectRepository(HrSettings)
    private readonly settingsRepo: Repository<HrSettings>,
  ) {}

  /** Effective rules: defaults merged with the tenant's overrides. */
  async getRules(tenantId: string): Promise<PayrollRules> {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    return mergeRules(settings?.rules);
  }

  async getCalculator(tenantId: string): Promise<PayrollCalculator> {
    return new PayrollCalculator(await this.getRules(tenantId));
  }

  async get(tenantId: string) {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    return { overrides: settings?.rules ?? {}, effective: mergeRules(settings?.rules) };
  }

  /** Replaces the tenant overrides (send {} to go back to the defaults). */
  async update(tenantId: string, rules: DeepPartial<PayrollRules>) {
    const effective = mergeRules(rules);
    this.validate(effective);
    let settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!settings) settings = this.settingsRepo.create({ tenantId });
    settings.rules = rules;
    await this.settingsRepo.save(settings);
    return { overrides: rules, effective };
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
    if (!(rules.general.daysPerMonth > 0)) {
      throw new BadRequestException('general.daysPerMonth must be positive');
    }
  }
}
