import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, Repository } from 'typeorm';
import { FuelNozzle, FuelPump, FuelTank } from '../entities/fuel-setup.entity';
import { FuelShift, FuelShiftCredit, FuelShiftLine } from '../entities/fuel-shift.entity';
import { FuelMeterAdjustment, FuelTankDip } from '../entities/fuel-control.entity';
import {
  CloseShiftDto,
  CreateNozzleDto,
  CreatePumpDto,
  CreateTankDto,
  MeterAdjustmentDto,
  OpenShiftDto,
  ShiftQueryDto,
  TankDipDto,
  UpdateNozzleDto,
  UpdatePumpDto,
  UpdateTankDto,
} from '../dto/fuel.dto';
import {
  buildShiftPostingLines,
  computeMargin,
  computeNozzleSales,
  computeShiftCash,
  reconcileTank,
} from './fuel-calc';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { StockMovement } from '@modules/inventory/entities/stock-movement.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { AutoPostingService, SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { AccountingSettingsService } from '@modules/accounting/services/accounting-settings.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { round, today } from '@shared/utils/document-totals.util';

export interface FuelActor {
  userId: string;
  /** fuel/shifts/manage: close other attendants' shifts. */
  canManageShifts?: boolean;
}

@Injectable()
export class FuelService {
  constructor(
    @InjectRepository(FuelTank) private readonly tankRepo: Repository<FuelTank>,
    @InjectRepository(FuelPump) private readonly pumpRepo: Repository<FuelPump>,
    @InjectRepository(FuelNozzle) private readonly nozzleRepo: Repository<FuelNozzle>,
    @InjectRepository(FuelShift) private readonly shiftRepo: Repository<FuelShift>,
    @InjectRepository(FuelShiftLine) private readonly lineRepo: Repository<FuelShiftLine>,
    @InjectRepository(FuelShiftCredit) private readonly creditRepo: Repository<FuelShiftCredit>,
    @InjectRepository(FuelTankDip) private readonly dipRepo: Repository<FuelTankDip>,
    @InjectRepository(FuelMeterAdjustment) private readonly meterRepo: Repository<FuelMeterAdjustment>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(StockMovement) private readonly movementRepo: Repository<StockMovement>,
    private readonly sequenceService: SequenceService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
    private readonly accountingSettings: AccountingSettingsService,
    private readonly salesInvoices: SalesInvoicesService,
  ) {}

  // ---------------------------------------------------------------- setup

  async createTank(tenantId: string, dto: CreateTankDto): Promise<FuelTank> {
    await this.assertFuelProduct(tenantId, dto.fuelProductId);
    await this.assertTankSlotFree(tenantId, dto.warehouseId, dto.fuelProductId);
    return this.tankRepo.save(this.tankRepo.create({ ...dto, tenantId }));
  }

  async updateTank(tenantId: string, id: string, dto: UpdateTankDto): Promise<FuelTank> {
    const tank = await this.getTank(tenantId, id);
    const productId = dto.fuelProductId ?? tank.fuelProductId;
    const warehouseId = dto.warehouseId ?? tank.warehouseId;
    if (productId !== tank.fuelProductId || warehouseId !== tank.warehouseId) {
      if (await this.inOpenShift(tenantId, { tankId: tank.id })) {
        throw new ConflictException('The tank is used by an open shift');
      }
      if (productId !== tank.fuelProductId) await this.assertFuelProduct(tenantId, productId);
      await this.assertTankSlotFree(tenantId, warehouseId, productId, tank.id);
    }
    Object.assign(tank, dto);
    return this.tankRepo.save(tank);
  }

  async findTanks(tenantId: string, withStock = false) {
    const tanks = await this.tankRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
    if (!withStock) return tanks;
    return Promise.all(tanks.map(async (t) => ({ ...t, bookQty: await this.bookQty(tenantId, t) })));
  }

  createPump(tenantId: string, dto: CreatePumpDto): Promise<FuelPump> {
    return this.pumpRepo.save(this.pumpRepo.create({ ...dto, tenantId }));
  }

  async updatePump(tenantId: string, id: string, dto: UpdatePumpDto): Promise<FuelPump> {
    const pump = await this.pumpRepo.findOne({ where: { id, tenantId } });
    if (!pump) throw new NotFoundException('Pump not found');
    Object.assign(pump, dto);
    return this.pumpRepo.save(pump);
  }

  findPumps(tenantId: string): Promise<FuelPump[]> {
    return this.pumpRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
  }

  async createNozzle(tenantId: string, dto: CreateNozzleDto): Promise<FuelNozzle> {
    await this.getPump(tenantId, dto.pumpId);
    await this.getTank(tenantId, dto.tankId);
    return this.nozzleRepo.save(
      this.nozzleRepo.create({ ...dto, tenantId, currentReading: dto.currentReading ?? 0, priceOverride: dto.priceOverride ?? null }),
    );
  }

  async updateNozzle(tenantId: string, id: string, dto: UpdateNozzleDto): Promise<FuelNozzle> {
    const nozzle = await this.getNozzle(tenantId, id);
    if (dto.pumpId) await this.getPump(tenantId, dto.pumpId);
    if (dto.tankId && dto.tankId !== nozzle.tankId) {
      await this.getTank(tenantId, dto.tankId);
      if (await this.inOpenShift(tenantId, { nozzleId: nozzle.id })) {
        throw new ConflictException('The nozzle is in an open shift');
      }
    }
    Object.assign(nozzle, dto);
    return this.nozzleRepo.save(nozzle);
  }

  async findNozzles(tenantId: string) {
    const nozzles = await this.nozzleRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
    const tanks = await this.tankRepo.find({ where: { tenantId } });
    const products = await this.productsById(tenantId, tanks.map((t) => t.fuelProductId));
    const tankById = new Map(tanks.map((t) => [t.id, t]));
    return nozzles.map((n) => {
      const product = products.get(tankById.get(n.tankId)?.fuelProductId ?? '');
      return { ...n, productId: product?.id ?? null, price: this.pumpPrice(n, product) };
    });
  }

  /** Audited meter correction; refused while the nozzle is in an open shift. */
  async adjustMeter(tenantId: string, userId: string, nozzleId: string, dto: MeterAdjustmentDto) {
    const nozzle = await this.getNozzle(tenantId, nozzleId);
    if (await this.inOpenShift(tenantId, { nozzleId })) {
      throw new ConflictException('Close the open shift of this nozzle before adjusting its meter');
    }
    const adjustment = await this.meterRepo.save(
      this.meterRepo.create({
        tenantId,
        nozzleId,
        oldReading: Number(nozzle.currentReading),
        newReading: dto.newReading,
        reason: dto.reason,
        userId,
      }),
    );
    nozzle.currentReading = dto.newReading;
    await this.nozzleRepo.save(nozzle);
    return adjustment;
  }

  findMeterAdjustments(tenantId: string, nozzleId?: string) {
    const where: any = { tenantId };
    if (nozzleId) where.nozzleId = nozzleId;
    return this.meterRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  // ---------------------------------------------------------------- shifts

  /**
   * Opens a shift: one open shift per attendant, and a nozzle can only be in
   * one open shift. Opening meters are the nozzles' current readings and the
   * pump price is fixed for the shift.
   */
  async openShift(tenantId: string, userId: string, dto: OpenShiftDto): Promise<FuelShift> {
    const mine = await this.shiftRepo.findOne({ where: { tenantId, userId, status: 'open' } });
    if (mine) throw new ConflictException(`You already have an open shift (${mine.shiftNumber})`);

    const busy = new Set(await this.busyNozzleIds(tenantId));
    let nozzles: FuelNozzle[];
    if (dto.nozzleIds?.length) {
      nozzles = await this.nozzleRepo.find({ where: { tenantId, id: In(dto.nozzleIds), isActive: true } });
      if (nozzles.length !== new Set(dto.nozzleIds).size) throw new NotFoundException('Nozzle not found or inactive');
      const taken = nozzles.filter((n) => busy.has(n.id));
      if (taken.length) {
        throw new ConflictException(`Nozzle(s) already in an open shift: ${taken.map((n) => n.nameEn || n.nameAr).join(', ')}`);
      }
    } else {
      nozzles = (await this.nozzleRepo.find({ where: { tenantId, isActive: true } })).filter((n) => !busy.has(n.id));
      if (dto.branchId) {
        const pumps = await this.pumpRepo.find({ where: { tenantId, branchId: dto.branchId } });
        const ids = new Set(pumps.map((p) => p.id));
        nozzles = nozzles.filter((n) => ids.has(n.pumpId));
      }
    }
    if (!nozzles.length) throw new BadRequestException('No free active nozzle to open a shift on');

    const tanks = await this.tankRepo.find({ where: { tenantId, id: In([...new Set(nozzles.map((n) => n.tankId))]) } });
    const tankById = new Map(tanks.map((t) => [t.id, t]));
    const products = await this.productsById(tenantId, tanks.map((t) => t.fuelProductId));

    const shiftNumber = await this.sequenceService.next(tenantId, 'fuel_shift', 'FSH');
    const shift = await this.shiftRepo.save(
      this.shiftRepo.create({
        tenantId,
        shiftNumber,
        userId,
        branchId: dto.branchId ?? null,
        status: 'open',
        openedAt: new Date(),
        notes: dto.notes ?? null,
      }),
    );
    const lines = nozzles.map((n) => {
      const tank = tankById.get(n.tankId);
      const product = tank ? products.get(tank.fuelProductId) : undefined;
      if (!tank || !product) throw new BadRequestException(`Nozzle ${n.nameEn || n.nameAr} has no tank / fuel product`);
      return this.lineRepo.create({
        shiftId: shift.id,
        nozzleId: n.id,
        tankId: tank.id,
        productId: product.id,
        openingReading: Number(n.currentReading),
        unitPrice: this.pumpPrice(n, product),
        taxRate: Number(product.salesTaxRate ?? 0),
      });
    });
    await this.lineRepo.save(lines);
    return this.findShift(tenantId, shift.id);
  }

  /**
   * Closes a shift: liters from the meters, sales at the pump price (VAT
   * included), stock issued from each tank at average cost, credit customers
   * invoiced, and the shift sales entry posted.
   */
  async closeShift(tenantId: string, actor: FuelActor, id: string, dto: CloseShiftDto): Promise<FuelShift> {
    const shift = await this.shiftRepo.findOne({ where: { id, tenantId } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status !== 'open') throw new ConflictException('The shift is already closed');
    if (shift.userId !== actor.userId && !actor.canManageShifts) {
      throw new ForbiddenException('This shift belongs to another attendant');
    }
    const date = dto.date ?? today();
    const lines = await this.lineRepo.find({ where: { shiftId: shift.id } });
    const readings = new Map(dto.readings.map((r) => [r.nozzleId, r]));
    for (const r of dto.readings) {
      if (!lines.some((l) => l.nozzleId === r.nozzleId)) {
        throw new BadRequestException(`Nozzle ${r.nozzleId} is not part of this shift`);
      }
    }

    // 1. meters -> liters and money
    for (const line of lines) {
      const r = readings.get(line.nozzleId);
      if (!r) throw new BadRequestException(`Closing reading missing for nozzle ${line.nozzleId}`);
      const sales = computeNozzleSales({
        openingReading: Number(line.openingReading),
        closingReading: r.closingReading,
        meterReset: r.meterReset,
        rolloverAt: r.rolloverAt,
        unitPrice: Number(line.unitPrice),
        taxRate: Number(line.taxRate),
      });
      Object.assign(line, sales, {
        closingReading: r.closingReading,
        meterReset: !!r.meterReset,
        rolloverAt: r.meterReset ? r.rolloverAt ?? Number(line.openingReading) : null,
        couponAmount: round(r.couponAmount ?? 0, 4),
      });
    }
    const sum = (f: (l: FuelShiftLine) => number) => round(lines.reduce((s, l) => s + Number(f(l)), 0), 4);
    const totalAmount = sum((l) => l.amount);
    const couponAmount = round(sum((l) => l.couponAmount) + Number(dto.couponAmount ?? 0), 4);
    const cardAmount = round(dto.cardAmount ?? 0, 4);

    // 2. credit sales: resolve product / price and check against what was sold
    const credits = this.resolveCredits(lines, dto);
    const requestedCredit = round(credits.reduce((s, c) => s + c.amount, 0), 4);
    computeShiftCash({ totalAmount, couponAmount, cardAmount, creditAmount: requestedCredit, cashCounted: dto.cashCounted });

    // 3. accounts must be configured before anything is moved
    const settings = await this.accountingSettings.find(tenantId);
    const useOverShort = !!settings?.cashOverShortAccountId;
    const keys: SettingsAccountKey[] = ['salesAccountId', 'cashAccountId', 'cogsAccountId', 'inventoryAccountId'];
    if (sum((l) => l.taxAmount) > 0) keys.push('outputTaxAccountId');
    if (cardAmount > 0) keys.push('bankAccountId');
    if (couponAmount > 0) keys.push('fuelCouponAccountId');
    if (credits.length) keys.push('receivableAccountId');
    await this.autoPosting.preflight(tenantId, date, keys);

    // 4. stock: one issue per tank, at its average cost
    const tanks = await this.tankRepo.find({ where: { tenantId, id: In([...new Set(lines.map((l) => l.tankId))]) } });
    for (const tank of tanks) {
      const tankLines = lines.filter((l) => l.tankId === tank.id);
      const liters = round(tankLines.reduce((s, l) => s + Number(l.liters), 0), 4);
      let unitCost = 0;
      if (liters > 0) {
        const issued = await this.stockService.issue(tenantId, actor.userId, {
          productId: tank.fuelProductId,
          warehouseId: tank.warehouseId,
          quantity: liters,
          referenceType: 'fuel_shift',
          referenceId: shift.id,
          description: `Fuel shift ${shift.shiftNumber}`,
        });
        unitCost = issued.unitCost;
      }
      for (const l of tankLines) {
        Object.assign(l, { unitCost }, computeMargin(Number(l.netAmount), Number(l.liters), unitCost));
      }
    }
    await this.lineRepo.save(lines);
    const totalCost = sum((l) => l.cost);

    // 5. credit customers: one posted sales invoice each (receivable, credit limit, customer balance)
    let invoicedNet = 0;
    let invoicedTax = 0;
    let creditAmount = 0;
    const creditRows: FuelShiftCredit[] = [];
    for (const c of credits) {
      const created = await this.salesInvoices.create(
        tenantId,
        actor.userId,
        {
          customerId: c.customerId,
          date,
          notes: `Fuel shift ${shift.shiftNumber}`,
          pricesIncludeTax: true,
          lines: [{ productId: c.productId, quantity: c.liters, unitPrice: c.unitPrice, taxRate: c.taxRate }],
        },
        {},
        { skipPriceChecks: true },
      );
      const invoice = await this.salesInvoices.post(tenantId, actor.userId, created.id);
      invoicedNet += Number(invoice.subtotal);
      invoicedTax += Number(invoice.taxAmount);
      creditAmount += Number(invoice.totalAmount);
      creditRows.push(
        this.creditRepo.create({
          shiftId: shift.id,
          customerId: c.customerId,
          productId: c.productId,
          liters: c.liters,
          amount: Number(invoice.totalAmount),
          salesInvoiceId: invoice.id,
        }),
      );
    }
    if (creditRows.length) await this.creditRepo.save(creditRows);
    creditAmount = round(creditAmount, 4);

    // 6. cash and the shift entry
    const cash = computeShiftCash({ totalAmount, couponAmount, cardAmount, creditAmount, cashCounted: dto.cashCounted });
    const netSales = round(sum((l) => l.netAmount) - invoicedNet, 4);
    const taxSales = round(sum((l) => l.taxAmount) - invoicedTax, 4);
    await this.autoPosting.post({
      tenantId,
      userId: actor.userId,
      journalType: JournalType.SALE,
      date,
      description: `Fuel shift ${shift.shiftNumber}`,
      sourceType: 'fuel_shift',
      sourceId: shift.id,
      buildLines: (_s, account) =>
        buildShiftPostingLines(
          { ...cash, cardAmount, couponAmount, netSales, taxAmount: taxSales, cost: totalCost, useOverShort },
          account,
        ),
    });

    // 7. meters move on
    const nozzles = await this.nozzleRepo.find({ where: { tenantId, id: In(lines.map((l) => l.nozzleId)) } });
    for (const n of nozzles) n.currentReading = Number(lines.find((l) => l.nozzleId === n.id)!.closingReading);
    await this.nozzleRepo.save(nozzles);

    Object.assign(shift, {
      status: 'closed',
      closedAt: new Date(),
      closedBy: actor.userId,
      date,
      totalLiters: sum((l) => l.liters),
      totalAmount,
      netAmount: sum((l) => l.netAmount),
      taxAmount: sum((l) => l.taxAmount),
      couponAmount,
      shiftCouponAmount: round(dto.couponAmount ?? 0, 4),
      cardAmount,
      creditAmount,
      cashExpected: cash.cashExpected,
      cashCounted: cash.cashCounted,
      cashDifference: cash.cashDifference,
      totalCost,
      totalMargin: sum((l) => l.margin),
      notes: dto.notes ?? shift.notes,
    });
    await this.shiftRepo.save(shift);
    return this.findShift(tenantId, shift.id);
  }

  findShifts(tenantId: string, q: ShiftQueryDto = {}) {
    const where: any = { tenantId };
    if (q.status) where.status = q.status;
    if (q.userId) where.userId = q.userId;
    if (q.from || q.to) {
      where.openedAt = Between(new Date(`${q.from ?? '1970-01-01'}T00:00:00Z`), new Date(`${q.to ?? '9999-12-31'}T23:59:59.999Z`));
    }
    return this.shiftRepo.find({ where, order: { openedAt: 'DESC' } });
  }

  async findShift(tenantId: string, id: string): Promise<FuelShift> {
    const shift = await this.shiftRepo.findOne({ where: { id, tenantId }, relations: ['lines', 'credits'] });
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  /** Shift report: nozzle lines, totals per product and the payment split. */
  async shiftReport(tenantId: string, id: string) {
    const shift = await this.findShift(tenantId, id);
    const nozzles = await this.nozzleRepo.find({ where: { tenantId, id: In(shift.lines.map((l) => l.nozzleId)) } });
    const products = await this.productsById(tenantId, shift.lines.map((l) => l.productId));
    const nozzleName = new Map(nozzles.map((n) => [n.id, n.nameEn || n.nameAr]));
    const byProduct = aggregateLines(shift.lines, (l) => l.productId, (k) => products.get(k)?.nameEn || products.get(k)?.nameAr || k);
    return {
      shift,
      lines: shift.lines.map((l) => ({ ...l, nozzleName: nozzleName.get(l.nozzleId) ?? null })),
      byProduct,
      payments: {
        total: Number(shift.totalAmount),
        coupons: Number(shift.couponAmount),
        card: Number(shift.cardAmount),
        credit: Number(shift.creditAmount),
        cashExpected: Number(shift.cashExpected),
        cashCounted: shift.cashCounted == null ? null : Number(shift.cashCounted),
        cashDifference: Number(shift.cashDifference),
      },
    };
  }

  /** Liters and sales per product or nozzle over closed shifts of the period. */
  async salesReport(tenantId: string, from: string, to: string, groupBy: 'product' | 'nozzle' = 'product') {
    const shifts = await this.shiftRepo.find({ where: { tenantId, status: 'closed', date: Between(from, to) } });
    if (!shifts.length) return { from, to, groupBy, rows: [] };
    const lines = await this.lineRepo.find({ where: { shiftId: In(shifts.map((s) => s.id)) } });
    let label: (k: string) => string;
    if (groupBy === 'nozzle') {
      const nozzles = await this.nozzleRepo.find({ where: { tenantId, id: In([...new Set(lines.map((l) => l.nozzleId))]) } });
      const names = new Map(nozzles.map((n) => [n.id, n.nameEn || n.nameAr]));
      label = (k) => names.get(k) ?? k;
    } else {
      const products = await this.productsById(tenantId, lines.map((l) => l.productId));
      label = (k) => products.get(k)?.nameEn || products.get(k)?.nameAr || k;
    }
    const rows = aggregateLines(lines, (l) => (groupBy === 'nozzle' ? l.nozzleId : l.productId), label);
    return { from, to, groupBy, rows };
  }

  // ---------------------------------------------------------------- tanks: dips, alerts, reconciliation

  /** Records a dip; optionally books the variance as a stock adjustment. */
  async recordDip(tenantId: string, userId: string, tankId: string, dto: TankDipDto) {
    const tank = await this.getTank(tenantId, tankId);
    if (dto.measuredQty > Number(tank.capacity) + 0.0001) {
      throw new BadRequestException(`Measured ${dto.measuredQty} exceeds the tank capacity ${Number(tank.capacity)}`);
    }
    if (dto.adjust && !dto.reason) throw new BadRequestException('Give a reason to adjust the stock');
    const bookQty = await this.bookQty(tenantId, tank);
    const variance = round(dto.measuredQty - bookQty, 4);
    const dip = await this.dipRepo.save(
      this.dipRepo.create({
        tenantId,
        tankId,
        dippedAt: new Date(),
        measuredQty: dto.measuredQty,
        bookQty,
        variance,
        adjusted: false,
        reason: dto.reason ?? null,
        userId,
      }),
    );
    if (dto.adjust && Math.abs(variance) > 0.0001) {
      await this.stockService.adjust(
        tenantId,
        userId,
        {
          productId: tank.fuelProductId,
          warehouseId: tank.warehouseId,
          quantity: variance,
          reason: `Tank dip ${tank.nameEn || tank.nameAr}: ${dto.reason}`,
        },
        { referenceType: 'fuel_tank_dip', referenceId: dip.id },
      );
      dip.adjusted = true;
      await this.dipRepo.save(dip);
    }
    return dip;
  }

  findDips(tenantId: string, tankId: string) {
    return this.dipRepo.find({ where: { tenantId, tankId }, order: { dippedAt: 'DESC' } });
  }

  /** Active tanks at or below their low-level threshold (book stock). */
  async lowLevelAlerts(tenantId: string) {
    const tanks = await this.tankRepo.find({ where: { tenantId, isActive: true } });
    const rows = [];
    for (const tank of tanks) {
      if (tank.minLevel == null) continue;
      const bookQty = await this.bookQty(tenantId, tank);
      if (bookQty <= Number(tank.minLevel) + 0.0001) {
        rows.push({
          tankId: tank.id,
          name: tank.nameEn || tank.nameAr,
          bookQty,
          minLevel: Number(tank.minLevel),
          capacity: Number(tank.capacity),
          fillPercent: Number(tank.capacity) > 0 ? round((bookQty / Number(tank.capacity)) * 100, 2) : null,
        });
      }
    }
    return rows;
  }

  async tankReconciliation(tenantId: string, tankId: string, from: string, to: string) {
    const tank = await this.getTank(tenantId, tankId);
    const fromTs = new Date(`${from}T00:00:00Z`);
    const toTs = new Date(`${to}T23:59:59.999Z`);
    const movements = await this.movementRepo.find({
      where: { tenantId, productId: tank.fuelProductId, warehouseId: tank.warehouseId, createdAt: LessThanOrEqual(toTs) },
    });
    const lastDip = await this.dipRepo.findOne({
      where: { tenantId, tankId, dippedAt: Between(fromTs, toTs) },
      order: { dippedAt: 'DESC' },
    });
    return {
      tankId,
      name: tank.nameEn || tank.nameAr,
      from,
      to,
      lastDipAt: lastDip?.dippedAt ?? null,
      ...reconcileTank(movements as any, fromTs, toTs, lastDip ? Number(lastDip.measuredQty) : null),
    };
  }

  // ---------------------------------------------------------------- helpers

  private resolveCredits(lines: FuelShiftLine[], dto: CloseShiftDto) {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const soldByProduct = new Map<string, number>();
    for (const l of lines) soldByProduct.set(l.productId, round((soldByProduct.get(l.productId) ?? 0) + Number(l.amount), 4));

    return (dto.creditSales ?? []).map((c) => {
      let line: FuelShiftLine | undefined;
      if (c.nozzleId) {
        line = lines.find((l) => l.nozzleId === c.nozzleId);
        if (!line) throw new BadRequestException(`Nozzle ${c.nozzleId} is not part of this shift`);
      } else {
        const productId = c.productId ?? (productIds.length === 1 ? productIds[0] : undefined);
        if (!productId) throw new BadRequestException('Credit sale: give the nozzle or product (the shift sold several products)');
        line = lines.find((l) => l.productId === productId);
        if (!line) throw new BadRequestException(`Product ${productId} was not sold in this shift`);
      }
      const remaining = round((soldByProduct.get(line.productId) ?? 0) - c.amount, 4);
      if (remaining < -0.0001) throw new BadRequestException('Credit sales exceed the amount sold of the product');
      soldByProduct.set(line.productId, remaining);
      const unitPrice = Number(line.unitPrice);
      if (!(unitPrice > 0)) throw new BadRequestException('The pump price is zero');
      return {
        customerId: c.customerId,
        productId: line.productId,
        unitPrice,
        taxRate: Number(line.taxRate),
        liters: round(c.amount / unitPrice, 4),
        amount: round(c.amount, 4),
      };
    });
  }

  private pumpPrice(nozzle: FuelNozzle, product?: Product | null): number {
    if (nozzle.priceOverride != null) return Number(nozzle.priceOverride);
    return Number(product?.sellPrice ?? 0);
  }

  private async bookQty(tenantId: string, tank: FuelTank): Promise<number> {
    const rows = await this.stockService.getStock(tenantId, tank.fuelProductId, tank.warehouseId);
    return round(rows.reduce((s, r) => s + Number(r.quantity), 0), 4);
  }

  private async productsById(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    const products = unique.length ? await this.productRepo.find({ where: { tenantId, id: In(unique) } }) : [];
    return new Map(products.map((p) => [p.id, p]));
  }

  private async busyNozzleIds(tenantId: string): Promise<string[]> {
    const open = await this.shiftRepo.find({ where: { tenantId, status: 'open' } });
    if (!open.length) return [];
    const lines = await this.lineRepo.find({ where: { shiftId: In(open.map((s) => s.id)) } });
    return lines.map((l) => l.nozzleId);
  }

  private async inOpenShift(tenantId: string, by: { nozzleId?: string; tankId?: string }): Promise<boolean> {
    const open = await this.shiftRepo.find({ where: { tenantId, status: 'open' } });
    if (!open.length) return false;
    const count = await this.lineRepo.count({ where: { shiftId: In(open.map((s) => s.id)), ...by } });
    return count > 0;
  }

  private async assertFuelProduct(tenantId: string, productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Fuel product not found');
    if (product.type === ProductType.SERVICE) throw new BadRequestException('Fuel must be a stockable product');
  }

  private async assertTankSlotFree(tenantId: string, warehouseId: string, productId: string, exceptId?: string) {
    const other = await this.tankRepo.findOne({ where: { tenantId, warehouseId, fuelProductId: productId } });
    if (other && other.id !== exceptId) {
      throw new ConflictException('Another tank already holds this product in this warehouse; give each tank its own warehouse');
    }
  }

  private async getTank(tenantId: string, id: string) {
    const tank = await this.tankRepo.findOne({ where: { id, tenantId } });
    if (!tank) throw new NotFoundException('Tank not found');
    return tank;
  }

  private async getPump(tenantId: string, id: string) {
    const pump = await this.pumpRepo.findOne({ where: { id, tenantId } });
    if (!pump) throw new NotFoundException('Pump not found');
    return pump;
  }

  private async getNozzle(tenantId: string, id: string) {
    const nozzle = await this.nozzleRepo.findOne({ where: { id, tenantId } });
    if (!nozzle) throw new NotFoundException('Nozzle not found');
    return nozzle;
  }
}

/** Sums liters, amounts, cost and margin of shift lines per key. */
export function aggregateLines(
  lines: Pick<FuelShiftLine, 'productId' | 'nozzleId' | 'liters' | 'amount' | 'netAmount' | 'taxAmount' | 'cost' | 'margin'>[],
  keyOf: (l: any) => string,
  label: (key: string) => string,
) {
  const rows = new Map<string, { key: string; name: string; liters: number; amount: number; netAmount: number; taxAmount: number; cost: number; margin: number }>();
  for (const l of lines) {
    const key = keyOf(l);
    const row = rows.get(key) ?? { key, name: label(key), liters: 0, amount: 0, netAmount: 0, taxAmount: 0, cost: 0, margin: 0 };
    row.liters = round(row.liters + Number(l.liters), 4);
    row.amount = round(row.amount + Number(l.amount), 4);
    row.netAmount = round(row.netAmount + Number(l.netAmount), 4);
    row.taxAmount = round(row.taxAmount + Number(l.taxAmount), 4);
    row.cost = round(row.cost + Number(l.cost), 4);
    row.margin = round(row.margin + Number(l.margin), 4);
    rows.set(key, row);
  }
  return [...rows.values()];
}
