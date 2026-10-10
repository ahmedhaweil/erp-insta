import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { DeliveryApp, Driver, RestaurantTable } from '../entities/master-data.entity';
import { KitchenStation } from '../entities/menu.entity';
import {
  KitchenTicket,
  RestaurantTicket,
  RestaurantVoidLog,
  TicketOrderType,
  TicketStatus,
} from '../entities/ticket.entity';
import { round } from '@shared/utils/document-totals.util';
import { RestaurantMasterService } from './restaurant-master.service';
import { driverCommission, minutesBetween } from './restaurant-calc';
import { DriverReportQueryDto, PeriodQueryDto, VoidLogQueryDto } from '../dto/restaurant.dto';

const period = (from?: string, to?: string) =>
  Between(new Date(`${from ?? '1970-01-01'}T00:00:00.000Z`), new Date(`${to ?? '2999-12-31'}T23:59:59.999Z`));

const avg = (values: number[]) => (values.length ? round(values.reduce((s, v) => s + v, 0) / values.length, 2) : 0);

@Injectable()
export class RestaurantReportsService {
  constructor(
    @InjectRepository(RestaurantTicket) private readonly ticketRepo: Repository<RestaurantTicket>,
    @InjectRepository(RestaurantVoidLog) private readonly voidLogRepo: Repository<RestaurantVoidLog>,
    @InjectRepository(KitchenTicket) private readonly kitchenRepo: Repository<KitchenTicket>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(DeliveryApp) private readonly appRepo: Repository<DeliveryApp>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectRepository(KitchenStation) private readonly stationRepo: Repository<KitchenStation>,
    private readonly master: RestaurantMasterService,
  ) {}

  /** Per driver: delivered (paid) tickets, sales, fees and commission on the driver's basis. */
  async driverCommissions(tenantId: string, q: DriverReportQueryDto) {
    const tickets = await this.ticketRepo.find({
      where: {
        tenantId,
        status: TicketStatus.PAID,
        orderType: TicketOrderType.DELIVERY,
        driverId: q.driverId ?? Not(IsNull()),
        paidAt: period(q.from, q.to),
      },
    });
    const ids = [...new Set(tickets.map((t) => t.driverId!))];
    const drivers = ids.length ? await this.driverRepo.find({ where: { tenantId, id: In(ids) } }) : [];
    const rows = drivers.map((driver) => ({
      driverId: driver.id,
      nameAr: driver.nameAr,
      nameEn: driver.nameEn,
      ...driverCommission(
        driver,
        tickets
          .filter((t) => t.driverId === driver.id)
          .map((t) => ({
            itemsNet: Number(t.itemsNet),
            serviceCharge: Number(t.serviceCharge),
            deliveryFee: Number(t.deliveryFee),
            totalAmount: Number(t.totalAmount),
          })),
      ),
    }));
    return {
      from: q.from,
      to: q.to,
      rows,
      totalCommission: round(rows.reduce((s, r) => s + r.commission, 0), 4),
    };
  }

  /** Per delivery app: paid tickets, net sales and the commission the app keeps. */
  async appSales(tenantId: string, q: PeriodQueryDto) {
    const tickets = await this.ticketRepo.find({
      where: { tenantId, status: TicketStatus.PAID, deliveryAppId: Not(IsNull()), paidAt: period(q.from, q.to) },
    });
    const apps = await this.appRepo.find({ where: { tenantId } });
    const rows = apps
      .map((app) => {
        const mine = tickets.filter((t) => t.deliveryAppId === app.id);
        const netSales = round(mine.reduce((s, t) => s + Number(t.itemsNet), 0), 4);
        return {
          appId: app.id,
          nameAr: app.nameAr,
          nameEn: app.nameEn,
          tickets: mine.length,
          netSales,
          totalAmount: round(mine.reduce((s, t) => s + Number(t.totalAmount), 0), 4),
          commissionPercent: Number(app.commissionPercent),
          commissionDue: round((netSales * Number(app.commissionPercent)) / 100, 4),
        };
      })
      .filter((r) => r.tickets > 0);
    return { from: q.from, to: q.to, rows };
  }

  voidLog(tenantId: string, q: VoidLogQueryDto) {
    const where: FindOptionsWhere<RestaurantVoidLog> = { tenantId };
    if (q.userId) where.userId = q.userId;
    if (q.ticketId) where.ticketId = q.ticketId;
    if (q.from || q.to) where.createdAt = period(q.from, q.to);
    return this.voidLogRepo.find({ where, order: { createdAt: 'DESC' }, take: 2000 });
  }

  /** Paid dine-in tickets per table (turnover, average stay) plus the tickets open right now. */
  async tableTurnover(tenantId: string, q: PeriodQueryDto, now = new Date()) {
    const paid = await this.ticketRepo.find({
      where: { tenantId, status: TicketStatus.PAID, orderType: TicketOrderType.DINE_IN, paidAt: period(q.from, q.to) },
    });
    const tables = await this.tableRepo.find({ where: { tenantId }, order: { sortOrder: 'ASC', name: 'ASC' } });
    const rows = tables.map((table) => {
      const mine = paid.filter((t) => t.tableId === table.id);
      return {
        tableId: table.id,
        name: table.name,
        seats: table.seats,
        tickets: mine.length,
        guests: mine.reduce((s, t) => s + Number(t.guests ?? 0), 0),
        sales: round(mine.reduce((s, t) => s + Number(t.totalAmount), 0), 4),
        averageMinutes: avg(mine.map((t) => minutesBetween(t.openedAt, t.paidAt!))),
      };
    });
    const open = await this.ticketRepo.find({ where: { tenantId, status: TicketStatus.OPEN }, order: { openedAt: 'ASC' } });
    const byType = Object.values(TicketOrderType).map((orderType) => {
      const mine = open.filter((t) => t.orderType === orderType);
      return {
        orderType,
        tickets: mine.length,
        totalAmount: round(mine.reduce((s, t) => s + Number(t.totalAmount), 0), 4),
        oldestMinutes: mine.length ? minutesBetween(mine[0].openedAt, now) : 0,
      };
    });
    return { from: q.from, to: q.to, tables: rows, openTickets: { count: open.length, byType } };
  }

  /** Per station: tickets prepared, average/max preparation time and late tickets. */
  async kitchenTimes(tenantId: string, q: PeriodQueryDto) {
    const settings = await this.master.getSettings(tenantId);
    const red = Number(settings.kdsRedMinutes);
    const done = await this.kitchenRepo.find({
      where: { tenantId, isCancellation: false, readyAt: Not(IsNull()), createdAt: period(q.from, q.to) },
    });
    const stations = await this.stationRepo.find({ where: { tenantId } });
    return {
      from: q.from,
      to: q.to,
      lateAfterMinutes: red,
      rows: stations.map((station) => {
        const mine = done.filter((k) => k.stationId === station.id);
        const prep = mine.map((k) => minutesBetween(k.createdAt, k.readyAt!));
        return {
          stationId: station.id,
          nameAr: station.nameAr,
          nameEn: station.nameEn,
          tickets: mine.length,
          averageWaitMinutes: avg(mine.filter((k) => k.startedAt).map((k) => minutesBetween(k.createdAt, k.startedAt!))),
          averagePrepMinutes: avg(prep),
          maxPrepMinutes: prep.length ? Math.max(...prep) : 0,
          late: prep.filter((m) => m >= red).length,
        };
      }),
    };
  }
}
