import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import {
  DeliveryApp,
  DeliveryAppPrice,
  DeliveryZone,
  DiningArea,
  Driver,
  RestaurantTable,
} from '../entities/master-data.entity';
import { ComboGroup, KitchenRoute, KitchenStation, ModifierType, ProductModifier } from '../entities/menu.entity';
import { RestaurantSettings } from '../entities/restaurant-settings.entity';
import { RestaurantTicket, TicketStatus } from '../entities/ticket.entity';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import {
  CreateComboGroupDto,
  CreateDeliveryAppDto,
  CreateDiningAreaDto,
  CreateDriverDto,
  CreateModifierDto,
  CreateStationDto,
  CreateTableDto,
  CreateZoneDto,
  SetAppPricesDto,
  SetRoutesDto,
  UpdateComboGroupDto,
  UpdateDeliveryAppDto,
  UpdateDiningAreaDto,
  UpdateDriverDto,
  UpdateModifierDto,
  UpdateRestaurantSettingsDto,
  UpdateStationDto,
  UpdateTableDto,
  UpdateZoneDto,
} from '../dto/restaurant.dto';

type Tenanted = { id: string; tenantId: string };

/** Restaurant master data: areas, tables, zones, drivers, apps, stations, modifiers, combos, settings. */
@Injectable()
export class RestaurantMasterService {
  constructor(
    @InjectRepository(DiningArea) private readonly areaRepo: Repository<DiningArea>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectRepository(DeliveryZone) private readonly zoneRepo: Repository<DeliveryZone>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(DeliveryApp) private readonly appRepo: Repository<DeliveryApp>,
    @InjectRepository(DeliveryAppPrice) private readonly appPriceRepo: Repository<DeliveryAppPrice>,
    @InjectRepository(KitchenStation) private readonly stationRepo: Repository<KitchenStation>,
    @InjectRepository(KitchenRoute) private readonly routeRepo: Repository<KitchenRoute>,
    @InjectRepository(ProductModifier) private readonly modifierRepo: Repository<ProductModifier>,
    @InjectRepository(ComboGroup) private readonly comboRepo: Repository<ComboGroup>,
    @InjectRepository(RestaurantSettings) private readonly settingsRepo: Repository<RestaurantSettings>,
    @InjectRepository(RestaurantTicket) private readonly ticketRepo: Repository<RestaurantTicket>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
  ) {}

  // ---------------------------------------------------------------- generic helpers

  private async findOr404<T extends Tenanted>(repo: Repository<T>, tenantId: string, id: string, what: string): Promise<T> {
    const row = await repo.findOne({ where: { id, tenantId } as any });
    if (!row) throw new NotFoundException(`${what} not found`);
    return row;
  }

  private async patch<T extends Tenanted>(repo: Repository<T>, tenantId: string, id: string, dto: object, what: string) {
    const row = await this.findOr404(repo, tenantId, id, what);
    Object.assign(row, dto);
    return repo.save(row);
  }

  private async assertProducts(tenantId: string, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (!wanted.length) return [];
    const found = await this.productRepo.find({ where: { tenantId, id: In(wanted) } });
    if (found.length !== wanted.length) throw new NotFoundException('Product not found');
    return found;
  }

  // ---------------------------------------------------------------- areas & tables

  findAreas(tenantId: string) {
    return this.areaRepo.find({ where: { tenantId }, order: { sortOrder: 'ASC', nameAr: 'ASC' } });
  }

  createArea(tenantId: string, dto: CreateDiningAreaDto) {
    return this.areaRepo.save(this.areaRepo.create({ ...dto, tenantId }));
  }

  updateArea(tenantId: string, id: string, dto: UpdateDiningAreaDto) {
    return this.patch(this.areaRepo, tenantId, id, dto, 'Dining area');
  }

  /** Tables with their derived occupancy (open tickets on them). */
  async findTables(tenantId: string, areaId?: string) {
    const tables = await this.tableRepo.find({
      where: { tenantId, ...(areaId ? { areaId } : {}) },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const open = await this.ticketRepo.find({ where: { tenantId, status: TicketStatus.OPEN, tableId: Not(null as any) } });
    return tables.map((t) => {
      const tickets = open.filter((o) => o.tableId === t.id);
      return {
        ...t,
        occupied: tickets.length > 0,
        openTickets: tickets.map((o) => ({
          id: o.id,
          ticketNumber: o.ticketNumber,
          displayNumber: o.displayNumber,
          guests: o.guests,
          openedAt: o.openedAt,
          totalAmount: Number(o.totalAmount),
        })),
      };
    });
  }

  async createTable(tenantId: string, dto: CreateTableDto) {
    await this.assertTableName(tenantId, dto.name);
    if (dto.areaId) await this.findOr404(this.areaRepo, tenantId, dto.areaId, 'Dining area');
    return this.tableRepo.save(this.tableRepo.create({ ...dto, tenantId }));
  }

  async updateTable(tenantId: string, id: string, dto: UpdateTableDto) {
    if (dto.name) await this.assertTableName(tenantId, dto.name, id);
    if (dto.areaId) await this.findOr404(this.areaRepo, tenantId, dto.areaId, 'Dining area');
    if (dto.isActive === false) {
      const busy = await this.ticketRepo.findOne({ where: { tenantId, tableId: id, status: TicketStatus.OPEN } });
      if (busy) throw new ConflictException('The table has an open ticket');
    }
    return this.patch(this.tableRepo, tenantId, id, dto, 'Table');
  }

  private async assertTableName(tenantId: string, name: string, exceptId?: string) {
    const existing = await this.tableRepo.findOne({ where: { tenantId, name } });
    if (existing && existing.id !== exceptId) throw new ConflictException(`Table "${name}" already exists`);
  }

  // ---------------------------------------------------------------- zones, drivers, apps

  findZones(tenantId: string) {
    return this.zoneRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
  }
  createZone(tenantId: string, dto: CreateZoneDto) {
    return this.zoneRepo.save(this.zoneRepo.create({ ...dto, tenantId }));
  }
  updateZone(tenantId: string, id: string, dto: UpdateZoneDto) {
    return this.patch(this.zoneRepo, tenantId, id, dto, 'Delivery zone');
  }

  findDrivers(tenantId: string) {
    return this.driverRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
  }
  createDriver(tenantId: string, dto: CreateDriverDto) {
    return this.driverRepo.save(this.driverRepo.create({ ...dto, tenantId }));
  }
  updateDriver(tenantId: string, id: string, dto: UpdateDriverDto) {
    return this.patch(this.driverRepo, tenantId, id, dto, 'Driver');
  }

  findApps(tenantId: string) {
    return this.appRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
  }
  createApp(tenantId: string, dto: CreateDeliveryAppDto) {
    return this.appRepo.save(this.appRepo.create({ ...dto, tenantId }));
  }
  updateApp(tenantId: string, id: string, dto: UpdateDeliveryAppDto) {
    return this.patch(this.appRepo, tenantId, id, dto, 'Delivery app');
  }

  async findAppPrices(tenantId: string, appId: string) {
    await this.findOr404(this.appRepo, tenantId, appId, 'Delivery app');
    return this.appPriceRepo.find({ where: { tenantId, appId } });
  }

  /** Upserts the given product prices of an app. */
  async setAppPrices(tenantId: string, appId: string, dto: SetAppPricesDto) {
    await this.findOr404(this.appRepo, tenantId, appId, 'Delivery app');
    await this.assertProducts(tenantId, dto.prices.map((p) => p.productId));
    for (const p of dto.prices) {
      const existing = await this.appPriceRepo.findOne({ where: { tenantId, appId, productId: p.productId } });
      await this.appPriceRepo.save(
        existing ? Object.assign(existing, { price: p.price }) : this.appPriceRepo.create({ tenantId, appId, ...p }),
      );
    }
    return this.findAppPrices(tenantId, appId);
  }

  async removeAppPrice(tenantId: string, appId: string, productId: string) {
    await this.appPriceRepo.delete({ tenantId, appId, productId });
    return { deleted: true };
  }

  // ---------------------------------------------------------------- kitchen stations & routing

  findStations(tenantId: string) {
    return this.stationRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
  }
  createStation(tenantId: string, dto: CreateStationDto) {
    return this.stationRepo.save(this.stationRepo.create({ ...dto, tenantId }));
  }
  updateStation(tenantId: string, id: string, dto: UpdateStationDto) {
    return this.patch(this.stationRepo, tenantId, id, dto, 'Kitchen station');
  }

  findRoutes(tenantId: string) {
    return this.routeRepo.find({ where: { tenantId } });
  }

  /** Replaces the stations of one product or one category. */
  async setRoutes(tenantId: string, dto: SetRoutesDto) {
    if (!!dto.productId === !!dto.categoryId) {
      throw new BadRequestException('Give either productId or categoryId');
    }
    if (dto.productId) await this.assertProducts(tenantId, [dto.productId]);
    const stations = [...new Set(dto.stationIds)];
    if (stations.length) {
      const found = await this.stationRepo.find({ where: { tenantId, id: In(stations) } });
      if (found.length !== stations.length) throw new NotFoundException('Kitchen station not found');
    }
    const key = dto.productId
      ? { tenantId, productId: dto.productId }
      : { tenantId, categoryId: dto.categoryId, productId: null as any };
    await this.routeRepo.delete(key as any);
    await this.routeRepo.save(
      stations.map((stationId) =>
        this.routeRepo.create({
          tenantId,
          stationId,
          productId: dto.productId ?? null,
          categoryId: dto.productId ? null : dto.categoryId!,
        }),
      ),
    );
    return this.findRoutes(tenantId);
  }

  // ---------------------------------------------------------------- modifiers & combos

  findModifiers(tenantId: string, productId?: string) {
    return this.modifierRepo.find({
      where: { tenantId, ...(productId ? { productId } : {}) },
      order: { sortOrder: 'ASC', nameAr: 'ASC' },
    });
  }

  async createModifier(tenantId: string, dto: CreateModifierDto) {
    this.validateModifier(dto);
    await this.assertProducts(tenantId, [dto.productId, dto.stockProductId, dto.ingredientProductId]);
    return this.modifierRepo.save(this.modifierRepo.create({ ...dto, tenantId }));
  }

  async updateModifier(tenantId: string, id: string, dto: UpdateModifierDto) {
    const row = await this.findOr404(this.modifierRepo, tenantId, id, 'Modifier');
    const merged = { ...row, ...dto };
    this.validateModifier(merged);
    await this.assertProducts(tenantId, [dto.productId, dto.stockProductId, dto.ingredientProductId]);
    return this.modifierRepo.save(Object.assign(row, dto));
  }

  async removeModifier(tenantId: string, id: string) {
    await this.findOr404(this.modifierRepo, tenantId, id, 'Modifier');
    await this.modifierRepo.delete({ id, tenantId });
    return { deleted: true };
  }

  private validateModifier(m: {
    type?: ModifierType;
    stockProductId?: string | null;
    stockQuantity?: number;
    ingredientProductId?: string | null;
  }) {
    if (m.type === ModifierType.WITHOUT && m.stockProductId) {
      throw new BadRequestException('A "without" modifier does not consume stock; use ingredientProductId');
    }
    if (m.type === ModifierType.ADDON && m.ingredientProductId) {
      throw new BadRequestException('An addon consumes a stock product; use stockProductId');
    }
    if (m.stockProductId && !(Number(m.stockQuantity) > 0)) {
      throw new BadRequestException('stockQuantity must be positive when a stock product is set');
    }
  }

  findComboGroups(tenantId: string, comboProductId?: string) {
    return this.comboRepo.find({
      where: { tenantId, ...(comboProductId ? { comboProductId } : {}) },
      order: { sortOrder: 'ASC' },
    });
  }

  async createComboGroup(tenantId: string, dto: CreateComboGroupDto) {
    const group = this.normalizeCombo({ ...dto, tenantId } as Partial<ComboGroup>);
    await this.assertProducts(tenantId, [dto.comboProductId, ...group.items!.map((i) => i.productId)]);
    if (group.items!.some((i) => i.productId === dto.comboProductId)) {
      throw new BadRequestException('A combo cannot contain itself');
    }
    return this.comboRepo.save(this.comboRepo.create(group));
  }

  async updateComboGroup(tenantId: string, id: string, dto: UpdateComboGroupDto) {
    const row = await this.findOr404(this.comboRepo, tenantId, id, 'Combo group');
    const merged = this.normalizeCombo({ ...row, ...dto } as Partial<ComboGroup>);
    await this.assertProducts(tenantId, merged.items!.map((i) => i.productId));
    return this.comboRepo.save(Object.assign(row, merged));
  }

  async removeComboGroup(tenantId: string, id: string) {
    await this.findOr404(this.comboRepo, tenantId, id, 'Combo group');
    await this.comboRepo.delete({ id, tenantId });
    return { deleted: true };
  }

  private normalizeCombo(group: Partial<ComboGroup>): Partial<ComboGroup> {
    const min = group.minPicks ?? 1;
    const max = group.maxPicks ?? 1;
    if (min > max) throw new BadRequestException('minPicks cannot exceed maxPicks');
    const items = (group.items ?? []).map((i) => ({
      productId: i.productId,
      extraPrice: Number(i.extraPrice ?? 0),
      quantity: Number(i.quantity ?? 1),
    }));
    if (new Set(items.map((i) => i.productId)).size !== items.length) {
      throw new BadRequestException('A product appears twice in the combo group');
    }
    return { ...group, minPicks: min, maxPicks: max, items };
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<RestaurantSettings> {
    const existing = await this.settingsRepo.findOne({ where: { tenantId } });
    return (
      existing ??
      this.settingsRepo.create({
        tenantId,
        serviceChargePercent: 0,
        serviceChargeProductId: null,
        deliveryFeeProductId: null,
        requireTableForDineIn: true,
        kdsYellowMinutes: 5,
        kdsOrangeMinutes: 10,
        kdsRedMinutes: 15,
        ticketNumberReset: 'daily' as any,
      })
    );
  }

  async updateSettings(tenantId: string, dto: UpdateRestaurantSettingsDto) {
    for (const id of [dto.serviceChargeProductId, dto.deliveryFeeProductId]) {
      if (!id) continue;
      const product = await this.productRepo.findOne({ where: { tenantId, id } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.type !== ProductType.SERVICE) {
        throw new BadRequestException(`${product.code} must be a service product to carry a charge`);
      }
    }
    const settings = await this.getSettings(tenantId);
    Object.assign(settings, dto);
    const y = Number(settings.kdsYellowMinutes);
    const o = Number(settings.kdsOrangeMinutes);
    const r = Number(settings.kdsRedMinutes);
    if (!(y < o && o < r)) throw new BadRequestException('KDS thresholds must increase: yellow < orange < red');
    return this.settingsRepo.save(settings);
  }
}
