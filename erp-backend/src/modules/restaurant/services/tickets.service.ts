import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, In, Repository } from 'typeorm';
import {
  DeliveryApp,
  DeliveryAppPrice,
  DeliveryZone,
  Driver,
  RestaurantTable,
} from '../entities/master-data.entity';
import { ComboGroup, ModifierType, ProductModifier } from '../entities/menu.entity';
import { TicketNumberReset } from '../entities/restaurant-settings.entity';
import {
  LineModifier,
  RestaurantTicket,
  RestaurantTicketLine,
  RestaurantVoidLog,
  TicketOrderType,
  TicketStatus,
} from '../entities/ticket.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { PosSession } from '@modules/pos/entities/pos-session.entity';
import { PosService } from '@modules/pos/services/pos.service';
import { PosOrderLineDto } from '@modules/pos/dto/create-pos-order.dto';
import { SequenceService } from '@shared/services/sequence.service';
import { round, today } from '@shared/utils/document-totals.util';
import { RestaurantMasterService } from './restaurant-master.service';
import { KitchenService } from './kitchen.service';
import {
  basePriceFor,
  computeTicketTotals,
  equalSplit,
  lineMergeKey,
  resolveComboPicks,
  splitSentQty,
  TicketTotals,
  unitPriceWithModifiers,
} from './restaurant-calc';
import {
  AddTicketLineDto,
  CreateTicketDto,
  PayTicketDto,
  SplitTicketDto,
  TicketQueryDto,
  UpdateTicketDto,
  UpdateTicketLineDto,
} from '../dto/restaurant.dto';

/** What the acting user may do beyond creating and editing tickets. */
export interface RestaurantActor {
  userId: string;
  /** restaurant/tickets/void: remove or reduce items already sent to the kitchen. */
  canVoid?: boolean;
  /** restaurant/tickets/discount: line and invoice discounts. */
  canDiscount?: boolean;
  /** pos/sessions/manage: pay into another cashier's session. */
  canManageSessions?: boolean;
}

const EPS = 0.0001;

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(RestaurantTicket) private readonly ticketRepo: Repository<RestaurantTicket>,
    @InjectRepository(RestaurantTicketLine) private readonly lineRepo: Repository<RestaurantTicketLine>,
    @InjectRepository(RestaurantVoidLog) private readonly voidLogRepo: Repository<RestaurantVoidLog>,
    @InjectRepository(RestaurantTable) private readonly tableRepo: Repository<RestaurantTable>,
    @InjectRepository(DeliveryZone) private readonly zoneRepo: Repository<DeliveryZone>,
    @InjectRepository(Driver) private readonly driverRepo: Repository<Driver>,
    @InjectRepository(DeliveryApp) private readonly appRepo: Repository<DeliveryApp>,
    @InjectRepository(DeliveryAppPrice) private readonly appPriceRepo: Repository<DeliveryAppPrice>,
    @InjectRepository(ProductModifier) private readonly modifierRepo: Repository<ProductModifier>,
    @InjectRepository(ComboGroup) private readonly comboRepo: Repository<ComboGroup>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(PosSession) private readonly sessionRepo: Repository<PosSession>,
    private readonly master: RestaurantMasterService,
    private readonly kitchen: KitchenService,
    private readonly sequence: SequenceService,
    private readonly pos: PosService,
  ) {}

  // ---------------------------------------------------------------- queries

  findAll(tenantId: string, q: TicketQueryDto) {
    const where: FindOptionsWhere<RestaurantTicket> = { tenantId };
    if (q.status) where.status = q.status;
    if (q.orderType) where.orderType = q.orderType;
    if (q.tableId) where.tableId = q.tableId;
    if (q.driverId) where.driverId = q.driverId;
    if (q.from || q.to) {
      where.openedAt = Between(
        new Date(`${q.from ?? '1970-01-01'}T00:00:00.000Z`),
        new Date(`${q.to ?? '2999-12-31'}T23:59:59.999Z`),
      );
    }
    return this.ticketRepo.find({ where, order: { openedAt: 'DESC' }, take: 500 });
  }

  async findById(tenantId: string, id: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!ticket) throw new NotFoundException('Ticket not found');
    ticket.lines = (ticket.lines ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    return ticket;
  }

  async splitPreview(tenantId: string, id: string, ways: number) {
    const ticket = await this.findById(tenantId, id);
    return { ticketId: id, totalAmount: Number(ticket.totalAmount), ways, shares: equalSplit(Number(ticket.totalAmount), ways) };
  }

  // ---------------------------------------------------------------- create / update

  async create(tenantId: string, actor: RestaurantActor, dto: CreateTicketDto) {
    const settings = await this.master.getSettings(tenantId);
    const ticket = this.ticketRepo.create({
      tenantId,
      orderType: dto.orderType,
      status: TicketStatus.OPEN,
      guests: dto.guests ?? null,
      customerPhone: dto.customerPhone ?? null,
      notes: dto.notes ?? null,
      invoiceDiscount: 0,
      deliveryFee: 0,
      openedAt: new Date(),
      createdBy: actor.userId,
    });

    if (dto.orderType === TicketOrderType.DINE_IN) {
      if (dto.tableId) {
        await this.assertFreeTable(tenantId, dto.tableId);
        ticket.tableId = dto.tableId;
      } else if (settings.requireTableForDineIn) {
        throw new BadRequestException('A table is required for dine-in');
      }
    } else if (dto.tableId) {
      throw new BadRequestException('Only dine-in tickets take a table');
    }

    if (dto.customerId) {
      const customer = await this.customerRepo.findOne({ where: { id: dto.customerId, tenantId } });
      if (!customer) throw new NotFoundException('Customer not found');
      ticket.customerId = customer.id;
      ticket.customerPhone = ticket.customerPhone ?? customer.phone ?? null;
      if (dto.orderType === TicketOrderType.DELIVERY) {
        ticket.deliveryAddress = dto.deliveryAddress ?? customer.address ?? null;
      }
    }

    if (dto.orderType === TicketOrderType.DELIVERY) {
      if (!ticket.customerId) throw new BadRequestException('A customer is required for delivery');
      ticket.deliveryAddress = dto.deliveryAddress ?? ticket.deliveryAddress ?? null;
      if (!ticket.deliveryAddress) throw new BadRequestException('A delivery address is required');
      if (!dto.zoneId) throw new BadRequestException('A delivery zone is required');
      const zone = await this.activeZone(tenantId, dto.zoneId);
      ticket.zoneId = zone.id;
      ticket.deliveryFee = dto.deliveryFee ?? Number(zone.fee);
      if (dto.driverId) ticket.driverId = (await this.activeDriver(tenantId, dto.driverId)).id;
    } else if (dto.zoneId || dto.driverId || dto.deliveryFee) {
      throw new BadRequestException('Zone, driver and delivery fee apply to delivery tickets only');
    }

    if (dto.deliveryAppId) {
      const app = await this.appRepo.findOne({ where: { id: dto.deliveryAppId, tenantId, isActive: true } });
      if (!app) throw new NotFoundException('Delivery app not found');
      if (!dto.appReference?.trim()) throw new BadRequestException('The app order reference is required');
      ticket.deliveryAppId = app.id;
      ticket.appReference = dto.appReference.trim();
    }

    if (dto.sessionId) {
      const session = await this.sessionRepo.findOne({ where: { id: dto.sessionId, tenantId, status: 'open' } });
      if (!session) throw new NotFoundException('Open session not found');
      ticket.sessionId = session.id;
    }

    ticket.ticketNumber = await this.sequence.next(tenantId, 'restaurant_ticket', 'REST');
    ticket.displayNumber = await this.nextDisplayNumber(tenantId, settings.ticketNumberReset, ticket.sessionId);
    const saved = await this.ticketRepo.save(ticket);

    const lines: RestaurantTicketLine[] = [];
    for (const line of dto.lines ?? []) await this.addLineTo(tenantId, actor, saved, lines, line);
    await this.recalc(tenantId, saved, lines);
    return this.findById(tenantId, saved.id);
  }

  async update(tenantId: string, actor: RestaurantActor, id: string, dto: UpdateTicketDto) {
    const ticket = await this.loadOpen(tenantId, id);
    const isDelivery = ticket.orderType === TicketOrderType.DELIVERY;
    if ((dto.zoneId || dto.deliveryFee != null || dto.deliveryAddress) && !isDelivery) {
      throw new BadRequestException('Zone, delivery fee and address apply to delivery tickets only');
    }
    if (dto.invoiceDiscount != null && round(dto.invoiceDiscount, 4) !== round(Number(ticket.invoiceDiscount), 4)) {
      if (!actor.canDiscount) throw new ForbiddenException('Discounts need the restaurant/tickets/discount permission');
      ticket.invoiceDiscount = dto.invoiceDiscount;
    }
    if (dto.customerId) {
      const customer = await this.customerRepo.findOne({ where: { id: dto.customerId, tenantId } });
      if (!customer) throw new NotFoundException('Customer not found');
      ticket.customerId = customer.id;
    }
    if (dto.zoneId) {
      const zone = await this.activeZone(tenantId, dto.zoneId);
      ticket.zoneId = zone.id;
      if (dto.deliveryFee == null) ticket.deliveryFee = Number(zone.fee);
    }
    if (dto.deliveryFee != null) ticket.deliveryFee = dto.deliveryFee;
    if (dto.deliveryAddress) ticket.deliveryAddress = dto.deliveryAddress;
    if (dto.guests != null) ticket.guests = dto.guests;
    if (dto.customerPhone != null) ticket.customerPhone = dto.customerPhone;
    if (dto.notes != null) ticket.notes = dto.notes;
    if (dto.appReference != null) {
      if (!ticket.deliveryAppId) throw new BadRequestException('The ticket has no delivery app');
      if (!dto.appReference.trim()) throw new BadRequestException('The app order reference is required');
      ticket.appReference = dto.appReference.trim();
    }
    await this.recalc(tenantId, ticket, ticket.lines);
    return this.findById(tenantId, id);
  }

  // ---------------------------------------------------------------- lines

  async addLines(tenantId: string, actor: RestaurantActor, id: string, dtos: AddTicketLineDto[]) {
    const ticket = await this.loadOpen(tenantId, id);
    for (const dto of dtos) await this.addLineTo(tenantId, actor, ticket, ticket.lines, dto);
    await this.recalc(tenantId, ticket, ticket.lines);
    return this.findById(tenantId, id);
  }

  async updateLine(tenantId: string, actor: RestaurantActor, id: string, lineId: string, dto: UpdateTicketLineDto) {
    const ticket = await this.loadOpen(tenantId, id);
    const line = this.lineOf(ticket, lineId);
    if (line.comboParentLineId) throw new BadRequestException('Change the combo line, not its components');
    const children = ticket.lines.filter((l) => l.comboParentLineId === line.id);

    if (dto.discount != null && round(dto.discount, 4) !== round(Number(line.discount), 4)) {
      if (!actor.canDiscount) throw new ForbiddenException('Discounts need the restaurant/tickets/discount permission');
      line.discount = dto.discount;
    }
    if (dto.note !== undefined) line.note = dto.note;
    if (dto.quantity != null && Math.abs(dto.quantity - Number(line.quantity)) > EPS) {
      const oldQty = Number(line.quantity);
      const newQty = round(dto.quantity, 4);
      const reductions = [line, ...children].map((l) => {
        const factor = l === line ? 1 : Number(l.comboUnitQty ?? 1);
        return { l, oldQty: Number(l.quantity), newQty: round(newQty * factor, 4) };
      });
      if (newQty < oldQty) await this.guardReduction(tenantId, actor, ticket, reductions, dto.reason);
      for (const r of reductions) r.l.quantity = r.newQty;
    }
    await this.lineRepo.save([line, ...children]);
    await this.recalc(tenantId, ticket, ticket.lines);
    return this.findById(tenantId, id);
  }

  async removeLine(tenantId: string, actor: RestaurantActor, id: string, lineId: string, reason?: string) {
    const ticket = await this.loadOpen(tenantId, id);
    const line = this.lineOf(ticket, lineId);
    if (line.comboParentLineId) throw new BadRequestException('Remove the combo line, not its components');
    const group = [line, ...ticket.lines.filter((l) => l.comboParentLineId === line.id)];
    await this.guardReduction(
      tenantId,
      actor,
      ticket,
      group.map((l) => ({ l, oldQty: Number(l.quantity), newQty: 0 })),
      reason,
    );
    // Lines never sent disappear; sent ones stay at 0 until the cancellation reaches the kitchen
    const unsent = group.filter((l) => Number(l.sentQty) <= EPS);
    const sent = group.filter((l) => Number(l.sentQty) > EPS);
    for (const l of sent) l.quantity = 0;
    if (sent.length) await this.lineRepo.save(sent);
    if (unsent.length) await this.lineRepo.delete({ id: In(unsent.map((l) => l.id)) });
    ticket.lines = ticket.lines.filter((l) => !unsent.includes(l));
    await this.recalc(tenantId, ticket, ticket.lines);
    return this.findById(tenantId, id);
  }

  /**
   * Reducing or removing items already sent to the kitchen needs the void
   * permission and is written to the void log (Instasoft's delete_item audit).
   */
  private async guardReduction(
    tenantId: string,
    actor: RestaurantActor,
    ticket: RestaurantTicket,
    changes: { l: RestaurantTicketLine; oldQty: number; newQty: number }[],
    reason?: string,
  ) {
    const logged = changes
      .map((c) => ({ ...c, voidQty: round(Math.min(c.oldQty, Number(c.l.sentQty)) - c.newQty, 4) }))
      .filter((c) => c.voidQty > EPS);
    if (!logged.length) return;
    if (!actor.canVoid) {
      throw new ForbiddenException('Items already sent to the kitchen need the restaurant/tickets/void permission');
    }
    await this.voidLogRepo.save(
      logged.map((c) =>
        this.voidLogRepo.create({
          tenantId,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          lineId: c.l.id,
          productId: c.l.productId,
          quantity: c.voidQty,
          unitPrice: Number(c.l.unitPrice),
          amount: round(c.voidQty * Number(c.l.unitPrice), 4),
          kind: 'line',
          reason: reason ?? null,
          userId: actor.userId,
        }),
      ),
    );
  }

  private async addLineTo(
    tenantId: string,
    actor: RestaurantActor,
    ticket: RestaurantTicket,
    lines: RestaurantTicketLine[],
    dto: AddTicketLineDto,
  ) {
    const product = await this.productRepo.findOne({ where: { id: dto.productId, tenantId, isActive: true } });
    if (!product) throw new NotFoundException(`Product ${dto.productId} not found or inactive`);
    if (dto.discount && !actor.canDiscount) {
      throw new ForbiddenException('Discounts need the restaurant/tickets/discount permission');
    }

    const modifierIds = [...new Set(dto.modifierIds ?? [])];
    const modifiers = modifierIds.length
      ? await this.modifierRepo.find({ where: { tenantId, id: In(modifierIds), productId: product.id, isActive: true } })
      : [];
    if (modifiers.length !== modifierIds.length) throw new BadRequestException('Modifier not available for this product');
    const snapshot: LineModifier[] = modifiers.map((m) => ({
      modifierId: m.id,
      type: m.type,
      nameAr: m.nameAr,
      nameEn: m.nameEn ?? null,
      price: Number(m.price),
      stockProductId: m.stockProductId,
      stockQuantity: Number(m.stockQuantity || 0),
      ingredientProductId: m.ingredientProductId,
    }));

    const appPrice = ticket.deliveryAppId
      ? await this.appPriceRepo.findOne({ where: { tenantId, appId: ticket.deliveryAppId, productId: product.id } })
      : null;
    const basePrice = basePriceFor(Number(product.sellPrice), appPrice ? Number(appPrice.price) : null);
    const unitPrice = unitPriceWithModifiers(basePrice, snapshot);
    const quantity = round(dto.quantity, 4);
    const note = dto.note?.trim() || null;
    const nextSort = () => lines.reduce((m, l) => Math.max(m, l.sortOrder), 0) + 1;

    const groups = await this.comboRepo.find({ where: { tenantId, comboProductId: product.id }, order: { sortOrder: 'ASC' } });
    if (!groups.length) {
      if (dto.comboPicks?.length) throw new BadRequestException(`${product.code} is not a combo`);
      const key = lineMergeKey(product.id, snapshot, note);
      const childParents = new Set(lines.map((l) => l.comboParentLineId).filter(Boolean));
      const same = lines.find(
        (l) =>
          Number(l.quantity) > EPS &&
          !l.comboParentLineId &&
          !childParents.has(l.id) &&
          !dto.discount &&
          lineMergeKey(l.productId, l.modifiers ?? [], l.note) === key &&
          Math.abs(Number(l.unitPrice) - unitPrice) < EPS,
      );
      if (same) {
        same.quantity = round(Number(same.quantity) + quantity, 4);
        await this.lineRepo.save(same);
        return same;
      }
      const line = await this.lineRepo.save(
        this.lineRepo.create({
          ticketId: ticket.id,
          productId: product.id,
          quantity,
          sentQty: 0,
          basePrice,
          unitPrice,
          modifiers: snapshot,
          note,
          discount: dto.discount ?? 0,
          taxRate: Number(product.salesTaxRate ?? 0),
          sortOrder: nextSort(),
        }),
      );
      lines.push(line);
      return line;
    }

    // Combo: the parent carries the combo price, the components their extra price
    const components = resolveComboPicks(groups, dto.comboPicks ?? []);
    const compProducts = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(components.map((c) => c.productId))]), isActive: true },
    });
    const compById = new Map(compProducts.map((p) => [p.id, p]));
    const parent = await this.lineRepo.save(
      this.lineRepo.create({
        ticketId: ticket.id,
        productId: product.id,
        quantity,
        sentQty: 0,
        basePrice,
        unitPrice,
        modifiers: snapshot,
        note,
        discount: dto.discount ?? 0,
        taxRate: Number(product.salesTaxRate ?? 0),
        sortOrder: nextSort(),
      }),
    );
    lines.push(parent);
    for (const c of components) {
      const comp = compById.get(c.productId);
      if (!comp) throw new NotFoundException(`Combo component ${c.productId} not found or inactive`);
      const child = await this.lineRepo.save(
        this.lineRepo.create({
          ticketId: ticket.id,
          productId: comp.id,
          quantity: round(quantity * c.unitQty, 4),
          sentQty: 0,
          basePrice: c.extraPrice,
          unitPrice: round(c.extraPrice / c.unitQty, 4),
          modifiers: [],
          note: null,
          comboParentLineId: parent.id,
          comboGroupId: c.groupId,
          comboUnitQty: c.unitQty,
          discount: 0,
          taxRate: Number(comp.salesTaxRate ?? 0),
          sortOrder: nextSort(),
        }),
      );
      lines.push(child);
    }
    return parent;
  }

  // ---------------------------------------------------------------- table moves, merge, split

  async transfer(tenantId: string, id: string, tableId: string) {
    const ticket = await this.loadOpen(tenantId, id);
    if (ticket.orderType !== TicketOrderType.DINE_IN) throw new BadRequestException('Only dine-in tickets sit at a table');
    if (ticket.tableId === tableId) throw new BadRequestException('The ticket is already on this table');
    await this.assertFreeTable(tenantId, tableId);
    ticket.tableId = tableId;
    await this.ticketRepo.save(this.withoutLines(ticket));
    return this.findById(tenantId, id);
  }

  /** Moves every line of `id` to `targetId` and voids `id` as merged. */
  async merge(tenantId: string, actor: RestaurantActor, id: string, targetId: string) {
    if (id === targetId) throw new BadRequestException('Cannot merge a ticket into itself');
    const source = await this.loadOpen(tenantId, id);
    const target = await this.loadOpen(tenantId, targetId);
    for (const line of source.lines) line.ticketId = target.id;
    if (source.lines.length) await this.lineRepo.save(source.lines);
    target.lines.push(...source.lines);
    target.invoiceDiscount = round(Number(target.invoiceDiscount) + Number(source.invoiceDiscount), 4);
    await this.recalc(tenantId, target, target.lines);

    source.status = TicketStatus.VOID;
    source.mergedIntoId = target.id;
    source.voidReason = `Merged into ${target.ticketNumber}`;
    source.voidedAt = new Date();
    source.voidedBy = actor.userId;
    source.invoiceDiscount = 0;
    await this.recalc(tenantId, source, []);
    return this.findById(tenantId, target.id);
  }

  /** Moves the selected quantities to a new ticket (same table and customer), to be paid separately. */
  async split(tenantId: string, actor: RestaurantActor, id: string, dto: SplitTicketDto) {
    const source = await this.loadOpen(tenantId, id);
    const requested = new Map<string, number>();
    for (const sel of dto.lines) {
      const line = this.lineOf(source, sel.lineId);
      if (line.comboParentLineId) throw new BadRequestException('Split the combo line, not its components');
      requested.set(line.id, round((requested.get(line.id) ?? 0) + sel.quantity, 4));
    }
    const topLevel = source.lines.filter((l) => !l.comboParentLineId && Number(l.quantity) > EPS);
    const remaining = topLevel.reduce((s, l) => s + Number(l.quantity) - (requested.get(l.id) ?? 0), 0);
    if (remaining <= EPS) throw new BadRequestException('Leave at least one item on the ticket (or transfer it instead)');

    const grossBefore = topLevel.reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);
    const settings = await this.master.getSettings(tenantId);
    const target = await this.ticketRepo.save(
      this.ticketRepo.create({
        tenantId,
        ticketNumber: await this.sequence.next(tenantId, 'restaurant_ticket', 'REST'),
        displayNumber: await this.nextDisplayNumber(tenantId, settings.ticketNumberReset, source.sessionId),
        orderType: source.orderType,
        status: TicketStatus.OPEN,
        tableId: source.tableId,
        customerId: source.customerId,
        customerPhone: source.customerPhone,
        deliveryAddress: source.deliveryAddress,
        zoneId: source.zoneId,
        deliveryFee: 0,
        driverId: source.driverId,
        deliveryAppId: source.deliveryAppId,
        appReference: source.appReference,
        sessionId: source.sessionId,
        invoiceDiscount: 0,
        openedAt: new Date(),
        createdBy: actor.userId,
        splitFromId: source.id,
      }),
    );

    const moved: RestaurantTicketLine[] = [];
    let movedGross = 0;
    for (const [lineId, qty] of requested) {
      const line = this.lineOf(source, lineId);
      const lineQty = Number(line.quantity);
      movedGross += qty * Number(line.unitPrice);
      const group = [line, ...source.lines.filter((l) => l.comboParentLineId === line.id)];
      if (Math.abs(qty - lineQty) < EPS) {
        for (const l of group) l.ticketId = target.id;
        await this.lineRepo.save(group);
        moved.push(...group);
        continue;
      }
      const ratio = qty / lineQty;
      const copies = new Map<string, string>();
      for (const l of group) {
        const factor = l === line ? 1 : Number(l.comboUnitQty ?? 1);
        const part = splitSentQty(Number(l.quantity), Number(l.sentQty), round(qty * factor, 4));
        const movedDiscount = round(Number(l.discount) * ratio, 4);
        const copy = await this.lineRepo.save(
          this.lineRepo.create({
            ticketId: target.id,
            productId: l.productId,
            quantity: part.moved.quantity,
            sentQty: part.moved.sentQty,
            basePrice: l.basePrice,
            unitPrice: l.unitPrice,
            modifiers: l.modifiers,
            note: l.note,
            comboParentLineId: l.comboParentLineId ? copies.get(l.comboParentLineId) ?? null : null,
            comboGroupId: l.comboGroupId,
            comboUnitQty: l.comboUnitQty,
            discount: movedDiscount,
            taxRate: l.taxRate,
            sortOrder: l.sortOrder,
          }),
        );
        copies.set(l.id, copy.id);
        moved.push(copy);
        l.quantity = part.kept.quantity;
        l.sentQty = part.kept.sentQty;
        l.discount = round(Number(l.discount) - movedDiscount, 4);
      }
      await this.lineRepo.save(group);
    }

    // The invoice discount follows the items in proportion
    if (Number(source.invoiceDiscount) > 0 && grossBefore > 0) {
      const share = round((Number(source.invoiceDiscount) * movedGross) / grossBefore, 4);
      target.invoiceDiscount = share;
      source.invoiceDiscount = round(Number(source.invoiceDiscount) - share, 4);
    }
    source.lines = source.lines.filter((l) => l.ticketId === source.id);
    await this.recalc(tenantId, source, source.lines);
    await this.recalc(tenantId, target, moved);
    return { source: await this.findById(tenantId, source.id), split: await this.findById(tenantId, target.id) };
  }

  async assignDriver(tenantId: string, id: string, driverId?: string | null) {
    const ticket = await this.loadOpenOrPaid(tenantId, id);
    if (ticket.orderType !== TicketOrderType.DELIVERY) throw new BadRequestException('Only delivery tickets have a driver');
    ticket.driverId = driverId ? (await this.activeDriver(tenantId, driverId)).id : null;
    await this.ticketRepo.save(this.withoutLines(ticket));
    return this.findById(tenantId, id);
  }

  /** Voids an unpaid ticket; items already sent are cancelled in the kitchen and logged. */
  async voidTicket(tenantId: string, actor: RestaurantActor, id: string, reason: string) {
    const ticket = await this.loadOpen(tenantId, id);
    const active = ticket.lines.filter((l) => Number(l.quantity) > EPS || Number(l.sentQty) > EPS);
    if (active.length) {
      await this.voidLogRepo.save(
        active.map((l) =>
          this.voidLogRepo.create({
            tenantId,
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            lineId: l.id,
            productId: l.productId,
            quantity: Math.max(Number(l.quantity), Number(l.sentQty)),
            unitPrice: Number(l.unitPrice),
            amount: round(Math.max(Number(l.quantity), Number(l.sentQty)) * Number(l.unitPrice), 4),
            kind: 'ticket',
            reason,
            userId: actor.userId,
          }),
        ),
      );
    }
    const cancellations = ticket.lines
      .filter((l) => Number(l.sentQty) > EPS)
      .map((l) => Object.assign(this.lineRepo.create({ ...l }), { quantity: 0 }));
    if (cancellations.length) {
      await this.kitchen.dispatch(tenantId, actor.userId, ticket, cancellations, { persistLines: false });
    }
    ticket.status = TicketStatus.VOID;
    ticket.voidReason = reason;
    ticket.voidedAt = new Date();
    ticket.voidedBy = actor.userId;
    await this.ticketRepo.save(this.withoutLines(ticket));
    return this.findById(tenantId, id);
  }

  async sendToKitchen(tenantId: string, actor: RestaurantActor, id: string) {
    const ticket = await this.loadOpen(tenantId, id);
    const result = await this.kitchen.dispatch(tenantId, actor.userId, ticket, ticket.lines);
    return { ...result, ticket: await this.findById(tenantId, id) };
  }

  // ---------------------------------------------------------------- payment

  /**
   * Settles the whole ticket through the POS: the sale (with the service
   * charge and delivery fee as service lines) is recorded by
   * PosService.createOrder, which issues stock, posts revenue, VAT, COGS and
   * cash/card. Stock leaves only here, once. Paying twice is idempotent
   * through the client reference.
   */
  async pay(tenantId: string, actor: RestaurantActor, id: string, dto: PayTicketDto) {
    let ticket = await this.loadOpen(tenantId, id);
    // Pending kitchen changes (new items, cancellations) go out first
    if (ticket.lines.some((l) => Math.abs(Number(l.quantity) - Number(l.sentQty)) > EPS)) {
      await this.kitchen.dispatch(tenantId, actor.userId, ticket, ticket.lines);
      ticket = await this.loadOpen(tenantId, id);
    }
    const lines = ticket.lines.filter((l) => Number(l.quantity) > EPS).sort((a, b) => a.sortOrder - b.sortOrder);
    if (!lines.length) throw new BadRequestException('The ticket has no items');

    const settings = await this.master.getSettings(tenantId);
    const totals = await this.recalc(tenantId, ticket, lines);
    const parents = new Set(lines.map((l) => l.comboParentLineId).filter(Boolean));

    const orderLines: PosOrderLineDto[] = [];
    const skipStockLines: number[] = [];
    for (const line of lines) {
      const amounts = totals.lines.get(line.id)!;
      if (parents.has(line.id)) skipStockLines.push(orderLines.length);
      orderLines.push({
        productId: line.productId,
        quantity: Number(line.quantity),
        unitPrice: Number(line.unitPrice),
        discount: amounts.discount,
        taxRate: Number(line.taxRate),
      });
      for (const m of line.modifiers ?? []) {
        if (m.type === ModifierType.ADDON && m.stockProductId && Number(m.stockQuantity) > 0) {
          orderLines.push({
            productId: m.stockProductId,
            quantity: round(Number(line.quantity) * Number(m.stockQuantity), 4),
            unitPrice: 0,
            discount: 0,
            taxRate: 0,
          });
        }
      }
    }
    if (totals.serviceCharge > 0) {
      if (!settings.serviceChargeProductId) {
        throw new BadRequestException('Set the service charge product in the restaurant settings');
      }
      orderLines.push(await this.chargeLine(tenantId, settings.serviceChargeProductId, totals.serviceCharge));
    }
    if (totals.deliveryFee > 0) {
      if (!settings.deliveryFeeProductId) {
        throw new BadRequestException('Set the delivery fee product in the restaurant settings');
      }
      orderLines.push(await this.chargeLine(tenantId, settings.deliveryFeeProductId, totals.deliveryFee));
    }

    const order = await this.pos.createOrder(
      tenantId,
      { userId: actor.userId, canManageSessions: actor.canManageSessions },
      {
        sessionId: dto.sessionId,
        customerId: ticket.customerId ?? undefined,
        clientReference: `restaurant-ticket-${ticket.id}`,
        paymentMethod: dto.paymentMethod,
        cashAmount: dto.cashAmount,
        cashReceived: dto.cashReceived,
        // Ticket prices (app prices, modifiers, combos, discounts) are final:
        // POS promotions would change the amounts the guest was shown.
        applyPromotions: false,
        lines: orderLines,
      },
      { trustedPrices: true, skipStockLines },
    );
    if (Math.abs(Number(order.totalAmount) - totals.totalAmount) > 0.01) {
      throw new ConflictException(
        `The POS sale total (${order.totalAmount}) differs from the ticket total (${totals.totalAmount})`,
      );
    }

    ticket.status = TicketStatus.PAID;
    ticket.posOrderId = order.id;
    ticket.paidAt = new Date();
    ticket.paidBy = actor.userId;
    await this.ticketRepo.save(this.withoutLines(ticket));
    return { ticket: await this.findById(tenantId, id), posOrder: order };
  }

  private async chargeLine(tenantId: string, productId: string, amount: number): Promise<PosOrderLineDto> {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Charge product not found');
    return { productId, quantity: 1, unitPrice: amount, discount: 0, taxRate: Number(product.salesTaxRate ?? 0) };
  }

  // ---------------------------------------------------------------- helpers

  /** Recomputes and stores the ticket totals. */
  async recalc(tenantId: string, ticket: RestaurantTicket, lines: RestaurantTicketLine[]): Promise<TicketTotals> {
    const settings = await this.master.getSettings(tenantId);
    const rateOf = async (productId?: string | null) => {
      if (!productId) return 0;
      const p = await this.productRepo.findOne({ where: { id: productId, tenantId } });
      return Number(p?.salesTaxRate ?? 0);
    };
    const totals = computeTicketTotals({
      orderType: ticket.orderType,
      lines: lines.map((l) => ({
        id: l.id,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discount),
        taxRate: Number(l.taxRate),
      })),
      invoiceDiscount: Number(ticket.invoiceDiscount),
      serviceChargePercent: Number(settings.serviceChargePercent),
      serviceChargeTaxRate: await rateOf(settings.serviceChargeProductId),
      deliveryFee: Number(ticket.deliveryFee),
      deliveryFeeTaxRate: await rateOf(settings.deliveryFeeProductId),
    });
    Object.assign(ticket, {
      itemsGross: totals.itemsGross,
      discountTotal: totals.discountTotal,
      itemsNet: totals.itemsNet,
      serviceChargePercent: totals.serviceChargePercent,
      serviceCharge: totals.serviceCharge,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      totalAmount: totals.totalAmount,
    });
    await this.ticketRepo.save(this.withoutLines(ticket));
    return totals;
  }

  /** Saving a ticket must not cascade into its loaded lines. */
  private withoutLines(ticket: RestaurantTicket): RestaurantTicket {
    const { lines: _lines, ...rest } = ticket;
    return rest as RestaurantTicket;
  }

  private async loadOpen(tenantId: string, id: string) {
    const ticket = await this.findById(tenantId, id);
    if (ticket.status !== TicketStatus.OPEN) throw new ConflictException(`Ticket ${ticket.ticketNumber} is ${ticket.status}`);
    return ticket;
  }

  private async loadOpenOrPaid(tenantId: string, id: string) {
    const ticket = await this.findById(tenantId, id);
    if (ticket.status === TicketStatus.VOID) throw new ConflictException(`Ticket ${ticket.ticketNumber} is void`);
    return ticket;
  }

  private lineOf(ticket: RestaurantTicket, lineId: string) {
    const line = ticket.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('Ticket line not found');
    return line;
  }

  /** A table is occupied while an open ticket references it. */
  private async assertFreeTable(tenantId: string, tableId: string) {
    const table = await this.tableRepo.findOne({ where: { id: tableId, tenantId, isActive: true } });
    if (!table) throw new NotFoundException('Table not found or inactive');
    const busy = await this.ticketRepo.findOne({ where: { tenantId, tableId, status: TicketStatus.OPEN } });
    if (busy) throw new ConflictException(`Table ${table.name} is occupied by ${busy.ticketNumber}`);
    return table;
  }

  private async activeZone(tenantId: string, id: string) {
    const zone = await this.zoneRepo.findOne({ where: { id, tenantId, isActive: true } });
    if (!zone) throw new NotFoundException('Delivery zone not found');
    return zone;
  }

  private async activeDriver(tenantId: string, id: string) {
    const driver = await this.driverRepo.findOne({ where: { id, tenantId, isActive: true } });
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }

  private async nextDisplayNumber(tenantId: string, reset: TicketNumberReset, sessionId?: string | null) {
    let code = 'restaurant_display';
    if (reset === TicketNumberReset.SESSION && sessionId) code = `restaurant_display_s_${sessionId}`;
    else if (reset !== TicketNumberReset.GLOBAL) code = `restaurant_display_${today().replace(/-/g, '')}`;
    const formatted = await this.sequence.next(tenantId, code, 'D', 1);
    return Number(formatted.split('-').pop());
  }
}
