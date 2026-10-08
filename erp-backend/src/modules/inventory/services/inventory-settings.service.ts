import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { Warehouse } from '../entities/warehouse.entity';

export interface InventorySettings {
  /** When true, issues/transfers/adjustments may drive on-hand stock below zero. */
  allowNegativeStock: boolean;
  /** Days ahead used by the expiring-lots report when no horizon is given. */
  expiryAlertDays: number;
}

const DEFAULTS: InventorySettings = { allowNegativeStock: false, expiryAlertDays: 30 };

/**
 * Tenant-level inventory options, stored under `tenants.settings.inventory`
 * (no dedicated table). Negative stock is blocked unless explicitly allowed,
 * which keeps the historical behaviour.
 */
@Injectable()
export class InventorySettingsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @Optional()
    @InjectRepository(Warehouse)
    private readonly warehouseRepo?: Repository<Warehouse>,
  ) {}

  async get(tenantId: string): Promise<InventorySettings> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const stored = (tenant?.settings?.inventory ?? {}) as Partial<InventorySettings>;
    return {
      allowNegativeStock: stored.allowNegativeStock === true,
      expiryAlertDays: Number(stored.expiryAlertDays ?? DEFAULTS.expiryAlertDays) || DEFAULTS.expiryAlertDays,
    };
  }

  /**
   * Whether stock may go below zero. A warehouse with its own policy
   * (`warehouses.allow_negative_stock` true/false) overrides the tenant option.
   */
  async allowNegativeStock(tenantId: string, warehouseId?: string | null): Promise<boolean> {
    if (warehouseId && this.warehouseRepo) {
      const warehouse = await this.warehouseRepo.findOne({ where: { id: warehouseId, tenantId } });
      if (warehouse && warehouse.allowNegativeStock !== null && warehouse.allowNegativeStock !== undefined) {
        return warehouse.allowNegativeStock === true;
      }
    }
    return (await this.get(tenantId)).allowNegativeStock;
  }

  async update(tenantId: string, patch: Partial<InventorySettings>): Promise<InventorySettings> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const current = await this.get(tenantId);
    const next: InventorySettings = {
      allowNegativeStock: patch.allowNegativeStock ?? current.allowNegativeStock,
      expiryAlertDays: patch.expiryAlertDays ?? current.expiryAlertDays,
    };
    tenant.settings = { ...(tenant.settings ?? {}), inventory: next };
    await this.tenantRepo.save(tenant);
    return next;
  }
}
