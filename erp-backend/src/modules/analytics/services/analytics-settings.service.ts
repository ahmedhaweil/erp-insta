import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsSettings } from '../entities/analytics-settings.entity';
import { UpdateAnalyticsSettingsDto } from '../dto/analytics.dto';
import { DEFAULT_INSIGHT_THRESHOLDS, InsightThresholds } from './analytics-calculator';

export type AnalyticsSettingsValues = Omit<
  AnalyticsSettings,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettingsValues = {
  stagnationDays: 30,
  lowCoverDays: 14,
  overstockDays: DEFAULT_INSIGHT_THRESHOLDS.overstockDays,
  purchaseCoverDays: DEFAULT_INSIGHT_THRESHOLDS.purchaseCoverDays,
  salesDropPct: DEFAULT_INSIGHT_THRESHOLDS.salesDropPct,
  salesRisePct: DEFAULT_INSIGHT_THRESHOLDS.salesRisePct,
  profitDropPct: DEFAULT_INSIGHT_THRESHOLDS.profitDropPct,
  marginDropPoints: DEFAULT_INSIGHT_THRESHOLDS.marginDropPoints,
  slowValueCriticalPct: DEFAULT_INSIGHT_THRESHOLDS.slowValueCriticalPct,
  topItemSharePct: DEFAULT_INSIGHT_THRESHOLDS.topItemSharePct,
  topCustomerSharePct: DEFAULT_INSIGHT_THRESHOLDS.topCustomerSharePct,
  returnsRatioPct: DEFAULT_INSIGHT_THRESHOLDS.returnsRatioPct,
  expensesProfitWarnPct: DEFAULT_INSIGHT_THRESHOLDS.expensesProfitWarnPct,
  posCashDiffMin: DEFAULT_INSIGHT_THRESHOLDS.posCashDiffMin,
  alertCreditLimit: true,
  alertCustomerBalance: false,
  customerBalanceThreshold: 0,
  alertSupplierBalance: false,
  supplierBalanceThreshold: 0,
  alertMonthExpenses: false,
  monthExpensesThreshold: 0,
  alertNegativeTreasury: true,
  alertNegativeStock: true,
  alertExpiringLots: true,
  expiryDays: 30,
  alertInstallments: true,
  installmentDays: 7,
  alertCheques: true,
  chequeDays: 3,
  autoNotify: false,
  notifyUserIds: [],
};

const KEYS = Object.keys(DEFAULT_ANALYTICS_SETTINGS) as (keyof AnalyticsSettingsValues)[];

/** Per-tenant analytics thresholds and alert rules; defaults until first saved. */
@Injectable()
export class AnalyticsSettingsService {
  constructor(
    @InjectRepository(AnalyticsSettings)
    private readonly repo: Repository<AnalyticsSettings>,
  ) {}

  async get(tenantId: string): Promise<AnalyticsSettingsValues> {
    const row = await this.repo.findOne({ where: { tenantId } });
    const out = { ...DEFAULT_ANALYTICS_SETTINGS } as Record<string, unknown>;
    if (row) {
      for (const k of KEYS) {
        const v = (row as unknown as Record<string, unknown>)[k];
        if (v === null || v === undefined) continue;
        const def = DEFAULT_ANALYTICS_SETTINGS[k];
        out[k] = typeof def === 'number' ? Number(v) : v;
      }
    }
    return out as AnalyticsSettingsValues;
  }

  async update(tenantId: string, dto: UpdateAnalyticsSettingsDto): Promise<AnalyticsSettingsValues> {
    let row = await this.repo.findOne({ where: { tenantId } });
    if (!row) row = this.repo.create({ tenantId, ...DEFAULT_ANALYTICS_SETTINGS });
    for (const k of KEYS) {
      const v = (dto as Record<string, unknown>)[k];
      if (v !== undefined) (row as unknown as Record<string, unknown>)[k] = v;
    }
    await this.repo.save(row);
    return this.get(tenantId);
  }
}

export function thresholdsOf(s: AnalyticsSettingsValues, overstockDays?: number, coverDays?: number): InsightThresholds {
  return {
    salesDropPct: s.salesDropPct,
    salesRisePct: s.salesRisePct,
    profitDropPct: s.profitDropPct,
    marginDropPoints: s.marginDropPoints,
    slowValueCriticalPct: s.slowValueCriticalPct,
    topItemSharePct: s.topItemSharePct,
    topCustomerSharePct: s.topCustomerSharePct,
    returnsRatioPct: s.returnsRatioPct,
    expensesProfitWarnPct: s.expensesProfitWarnPct,
    posCashDiffMin: s.posCashDiffMin,
    overstockDays: overstockDays ?? s.overstockDays,
    purchaseCoverDays: coverDays ?? s.purchaseCoverDays,
  };
}
