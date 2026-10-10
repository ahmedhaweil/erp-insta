import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KitchenRoute } from '../entities/menu.entity';
import {
  KitchenTicket,
  KitchenTicketItem,
  KitchenTicketStatus,
  RestaurantTicket,
  RestaurantTicketLine,
} from '../entities/ticket.entity';
import { RestaurantTable } from '../entities/master-data.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { EventsGateway } from '@modules/realtime/gateways/events.gateway';
import { RestaurantMasterService } from './restaurant-master.service';
import { kdsLevel, kitchenDelta, minutesBetween } from './restaurant-calc';

const ACTIVE = [KitchenTicketStatus.NEW, KitchenTicketStatus.PREPARING, KitchenTicketStatus.READY];

/** Allowed forward moves of a kitchen ticket. */
const NEXT: Record<KitchenTicketStatus, KitchenTicketStatus[]> = {
  [KitchenTicketStatus.NEW]: [
    KitchenTicketStatus.PREPARING,
    KitchenTicketStatus.READY,
    KitchenTicketStatus.SERVED,
    KitchenTicketStatus.CANCELLED,
  ],
  [KitchenTicketStatus.PREPARING]: [KitchenTicketStatus.READY, KitchenTicketStatus.SERVED, KitchenTicketStatus.CANCELLED],
  [KitchenTicketStatus.READY]: [KitchenTicketStatus.SERVED, KitchenTicketStatus.CANCELLED],
  [KitchenTicketStatus.SERVED]: [],
  [KitchenTicketStatus.CANCELLED]: [],
};

@Injectable()
export class KitchenService {
  private readonly logger = new Logger(KitchenService.name);

  constructor(
    @InjectRepository(KitchenTicket) private readonly kitchenRepo: Repository<KitchenTicket>,
    @InjectRepository(KitchenRoute) private readonly routeRepo: Repository<KitchenRoute>,
    @InjectRepository(RestaurantTicketLine) private readonly lineRepo: Repository<RestaurantTicketLine>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    private readonly master: RestaurantMasterService,
    @Optional() private readonly events?: EventsGateway,
  ) {}

  /**
   * Sends the not-yet-sent quantities (and cancellations of quantities sent
   * earlier) of a ticket to its kitchen stations, then records the sent
   * quantities on the lines so nothing is sent twice. Lines reduced to zero
   * are removed once their cancellation is sent.
   */
  async dispatch(
    tenantId: string,
    userId: string,
    ticket: RestaurantTicket,
    lines: RestaurantTicketLine[],
    options: { persistLines?: boolean } = {},
  ) {
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = productIds.length
      ? await this.productRepo.find({ where: { tenantId, id: In(productIds) } })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const routes = await this.routeRepo.find({ where: { tenantId } });
    const parents = new Set(lines.filter((l) => l.comboParentLineId).map((l) => l.comboParentLineId));

    const delta = kitchenDelta(
      lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        categoryId: byId.get(l.productId)?.categoryId ?? null,
        quantity: Number(l.quantity),
        sentQty: Number(l.sentQty),
        modifiers: l.modifiers ?? [],
        note: l.note,
        nameAr: byId.get(l.productId)?.nameAr,
        nameEn: byId.get(l.productId)?.nameEn,
        isComboParent: parents.has(l.id),
      })),
      routes,
    );

    const table = ticket.tableId ? await this.tableRepo.findOne({ where: { id: ticket.tableId, tenantId } }) : null;
    const created: KitchenTicket[] = [];
    const make = async (stationId: string, items: KitchenTicketItem[], isCancellation: boolean) => {
      const kt = await this.kitchenRepo.save(
        this.kitchenRepo.create({
          tenantId,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          displayNumber: ticket.displayNumber,
          orderType: ticket.orderType,
          tableName: table?.name ?? null,
          stationId,
          status: KitchenTicketStatus.NEW,
          isCancellation,
          items,
          sentBy: userId,
        }),
      );
      created.push(kt);
    };
    for (const [stationId, items] of delta.orders) await make(stationId, items, false);
    for (const [stationId, items] of delta.cancellations) await make(stationId, items, true);

    if (options.persistLines === false) {
      for (const kt of created) this.emit(tenantId, 'restaurant.kitchen.created', kt);
      return { kitchenTickets: created, linesSent: delta.sent.length };
    }
    const sent = new Map(delta.sent.map((s) => [s.lineId, s.sentQty]));
    const toSave: RestaurantTicketLine[] = [];
    const toDelete: string[] = [];
    for (const line of lines) {
      if (!sent.has(line.id)) continue;
      line.sentQty = sent.get(line.id)!;
      if (Number(line.quantity) <= 0) toDelete.push(line.id);
      else toSave.push(line);
    }
    if (toSave.length) await this.lineRepo.save(toSave);
    if (toDelete.length) await this.lineRepo.delete({ id: In(toDelete) });

    for (const kt of created) this.emit(tenantId, 'restaurant.kitchen.created', kt);
    return { kitchenTickets: created, linesSent: delta.sent.length };
  }

  /** Active kitchen tickets with age, colour level and late flag (KDS). */
  async kds(tenantId: string, stationId?: string, now = new Date()) {
    const settings = await this.master.getSettings(tenantId);
    const thresholds = {
      yellow: Number(settings.kdsYellowMinutes),
      orange: Number(settings.kdsOrangeMinutes),
      red: Number(settings.kdsRedMinutes),
    };
    const rows = await this.kitchenRepo.find({
      where: { tenantId, status: In(ACTIVE), ...(stationId ? { stationId } : {}) },
      order: { createdAt: 'ASC' },
    });
    return rows.map((kt) => {
      const end = kt.readyAt ?? now;
      const ageMinutes = minutesBetween(kt.createdAt, end);
      return {
        ...kt,
        ageMinutes,
        level: kdsLevel(ageMinutes, thresholds),
        late: ageMinutes >= thresholds.red,
      };
    });
  }

  async setStatus(tenantId: string, id: string, status: KitchenTicketStatus, now = new Date()) {
    const kt = await this.kitchenRepo.findOne({ where: { id, tenantId } });
    if (!kt) throw new NotFoundException('Kitchen ticket not found');
    if (!NEXT[kt.status].includes(status)) {
      throw new BadRequestException(`Cannot move a kitchen ticket from ${kt.status} to ${status}`);
    }
    if (status === KitchenTicketStatus.CANCELLED) {
      kt.cancelledAt = now;
    } else {
      if (!kt.startedAt) kt.startedAt = now;
      if (status !== KitchenTicketStatus.PREPARING && !kt.readyAt) kt.readyAt = now;
      if (status === KitchenTicketStatus.SERVED) kt.servedAt = now;
    }
    kt.status = status;
    const saved = await this.kitchenRepo.save(kt);
    this.emit(tenantId, 'restaurant.kitchen.updated', saved);
    return saved;
  }

  findForTicket(tenantId: string, ticketId: string) {
    return this.kitchenRepo.find({ where: { tenantId, ticketId }, order: { createdAt: 'ASC' } });
  }

  private emit(tenantId: string, event: string, data: unknown) {
    try {
      if (this.events?.server) this.events.sendToTenant(tenantId, event, data);
    } catch (err) {
      this.logger.warn(`Realtime emit failed: ${(err as Error).message}`);
    }
  }
}
