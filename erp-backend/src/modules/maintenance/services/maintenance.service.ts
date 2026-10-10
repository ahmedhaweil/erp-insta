import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThan, Repository } from 'typeorm';
import {
  MaintenanceTicket,
  MaintenanceTicketHistory,
  MaintenanceTicketLabour,
  MaintenanceTicketPart,
  TicketStatus,
} from '../entities/maintenance-ticket.entity';
import { Technician } from '../entities/technician.entity';
import { MaintenanceSettings } from '../entities/maintenance-settings.entity';
import {
  AddLabourDto,
  AddPartDto,
  ApprovalDto,
  ChangeStatusDto,
  CreateTechnicianDto,
  CreateTicketDto,
  InvoiceTicketDto,
  RescheduleDto,
  TicketQueryDto,
  UpdateMaintenanceSettingsDto,
  UpdateTechnicianDto,
  UpdateTicketDto,
} from '../dto/maintenance.dto';
import {
  CLOSED_STATUSES,
  OPEN_STATUSES,
  assertEditable,
  assertTransition,
  assertWithinApproval,
} from './ticket-status';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { SalesInvoicesService } from '@modules/sales/services/sales-invoices.service';
import { SalesInvoiceStatus } from '@modules/sales/entities/sales-invoice.entity';
import { round, today } from '@shared/utils/document-totals.util';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MaintenanceService {
  constructor(
    @InjectRepository(MaintenanceTicket)
    private readonly ticketRepo: Repository<MaintenanceTicket>,
    @InjectRepository(MaintenanceTicketPart)
    private readonly partRepo: Repository<MaintenanceTicketPart>,
    @InjectRepository(MaintenanceTicketLabour)
    private readonly labourRepo: Repository<MaintenanceTicketLabour>,
    @InjectRepository(MaintenanceTicketHistory)
    private readonly historyRepo: Repository<MaintenanceTicketHistory>,
    @InjectRepository(Technician)
    private readonly technicianRepo: Repository<Technician>,
    @InjectRepository(MaintenanceSettings)
    private readonly settingsRepo: Repository<MaintenanceSettings>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly sequenceService: SequenceService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
    private readonly salesInvoices: SalesInvoicesService,
  ) {}

  // ---------------------------------------------------------------- technicians

  createTechnician(tenantId: string, dto: CreateTechnicianDto): Promise<Technician> {
    return this.technicianRepo.save(this.technicianRepo.create({ ...dto, tenantId }));
  }

  async updateTechnician(tenantId: string, id: string, dto: UpdateTechnicianDto): Promise<Technician> {
    const technician = await this.technicianRepo.findOne({ where: { id, tenantId } });
    if (!technician) throw new NotFoundException('Technician not found');
    Object.assign(technician, dto);
    return this.technicianRepo.save(technician);
  }

  findTechnicians(tenantId: string, activeOnly = false): Promise<Technician[]> {
    const where: any = { tenantId };
    if (activeOnly) where.isActive = true;
    return this.technicianRepo.find({ where, order: { nameAr: 'ASC' } });
  }

  // ---------------------------------------------------------------- settings

  async getSettings(tenantId: string): Promise<MaintenanceSettings> {
    const found = await this.settingsRepo.findOne({ where: { tenantId } });
    return found ?? this.settingsRepo.create({ tenantId, pricesIncludeTax: false });
  }

  async updateSettings(tenantId: string, dto: UpdateMaintenanceSettingsDto): Promise<MaintenanceSettings> {
    if (dto.defaultLabourProductId) {
      const product = await this.productRepo.findOne({ where: { id: dto.defaultLabourProductId, tenantId } });
      if (!product) throw new NotFoundException('Labour product not found');
      if (product.type !== ProductType.SERVICE) {
        throw new BadRequestException('The default labour product must be a service product');
      }
    }
    const settings = await this.getSettings(tenantId);
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }

  // ---------------------------------------------------------------- tickets

  async createTicket(tenantId: string, userId: string, dto: CreateTicketDto): Promise<MaintenanceTicket> {
    if (!dto.customerId && !dto.customerName) {
      throw new BadRequestException('Give a customer or the walk-in customer name');
    }
    if (dto.technicianId) await this.getTechnician(tenantId, dto.technicianId);
    const ticketNumber = await this.sequenceService.next(tenantId, 'maintenance_ticket', 'RPR');
    const ticket = await this.ticketRepo.save(
      this.ticketRepo.create({
        ...dto,
        tenantId,
        ticketNumber,
        receivedDate: dto.receivedDate ?? today(),
        maxApprovedCost: dto.maxApprovedCost ?? null,
        customerApproved: !!dto.customerApproved,
        approvedAt: dto.customerApproved ? new Date() : null,
        status: TicketStatus.RECEIVED,
        totalCost: 0,
        createdBy: userId,
      } as Partial<MaintenanceTicket>),
    );
    await this.logHistory(ticket.id, userId, null, TicketStatus.RECEIVED, 'Ticket received');
    return ticket;
  }

  async updateTicket(tenantId: string, id: string, dto: UpdateTicketDto): Promise<MaintenanceTicket> {
    const ticket = await this.getTicket(tenantId, id);
    if (CLOSED_STATUSES.includes(ticket.status)) {
      throw new ConflictException(`A ${ticket.status} ticket cannot be edited`);
    }
    if (dto.technicianId) await this.getTechnician(tenantId, dto.technicianId);
    if (dto.customerId !== undefined && dto.customerId !== ticket.customerId && ticket.salesInvoiceId) {
      throw new ConflictException('The ticket is invoiced; its customer cannot change');
    }
    Object.assign(ticket, dto);
    return this.ticketRepo.save(ticket);
  }

  findTickets(tenantId: string, q: TicketQueryDto = {}): Promise<MaintenanceTicket[]> {
    const qb = this.ticketRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .orderBy('t.created_at', 'DESC');
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    if (q.technicianId) qb.andWhere('t.technician_id = :tech', { tech: q.technicianId });
    if (q.customerId) qb.andWhere('t.customer_id = :cust', { cust: q.customerId });
    if (q.from) qb.andWhere('t.received_date >= :from', { from: q.from });
    if (q.to) qb.andWhere('t.received_date <= :to', { to: q.to });
    if (q.search) {
      qb.andWhere(
        '(t.ticket_number ILIKE :s OR t.customer_name ILIKE :s OR t.customer_phone ILIKE :s OR t.device_name ILIKE :s OR t.serial_number ILIKE :s)',
        { s: `%${q.search}%` },
      );
    }
    return qb.getMany();
  }

  async findTicket(tenantId: string, id: string): Promise<MaintenanceTicket> {
    const ticket = await this.ticketRepo.findOne({
      where: { id, tenantId },
      relations: ['parts', 'labour', 'history'],
    });
    if (!ticket) throw new NotFoundException('Repair ticket not found');
    ticket.history?.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    return ticket;
  }

  /** Moves the ticket through the workflow (see ticket-status.ts). */
  async changeStatus(
    tenantId: string,
    userId: string,
    id: string,
    dto: ChangeStatusDto,
  ): Promise<MaintenanceTicket> {
    if (dto.status === TicketStatus.RESCHEDULED) {
      throw new BadRequestException('Use the reschedule endpoint to give the new appointment date');
    }
    const ticket = await this.getTicket(tenantId, id);
    const from = ticket.status;
    const invoiced = await this.isInvoiced(tenantId, ticket);
    assertTransition({
      from,
      to: dto.status,
      previousStatus: ticket.previousStatus,
      customerApproved: ticket.customerApproved,
      isWarranty: this.underWarranty(ticket),
      totalCost: Number(ticket.totalCost),
      invoiced,
    });

    if (dto.status === TicketStatus.CANCELLED) {
      if (invoiced) {
        throw new ConflictException('Cancel the linked sales invoice (credit note) before cancelling the ticket');
      }
      await this.releaseReservations(tenantId, ticket);
    }
    if (dto.status === TicketStatus.DELIVERED) {
      if (!ticket.partsIssued) await this.issueParts(tenantId, userId, ticket, today());
      ticket.deliveredAt = new Date();
    }

    ticket.status = dto.status;
    if (from === TicketStatus.RESCHEDULED) ticket.previousStatus = null;
    const saved = await this.ticketRepo.save(ticket);
    await this.logHistory(ticket.id, userId, from, dto.status, dto.note ?? null);
    return saved;
  }

  /**
   * Parks the ticket until the new appointment; it later resumes to the
   * state it was in (Instasoft's calendar only overwrote the date).
   */
  async reschedule(tenantId: string, userId: string, id: string, dto: RescheduleDto): Promise<MaintenanceTicket> {
    const ticket = await this.getTicket(tenantId, id);
    const from = ticket.status;
    if (CLOSED_STATUSES.includes(from)) {
      throw new ConflictException(`A ${from} ticket cannot be rescheduled`);
    }
    if (from !== TicketStatus.RESCHEDULED) ticket.previousStatus = from;
    const oldDate = ticket.appointmentDate;
    ticket.appointmentDate = dto.appointmentDate;
    if (dto.promisedDate) ticket.promisedDate = dto.promisedDate;
    ticket.status = TicketStatus.RESCHEDULED;
    const saved = await this.ticketRepo.save(ticket);
    const note = `Appointment ${oldDate ?? '-'} -> ${dto.appointmentDate}${dto.note ? `: ${dto.note}` : ''}`;
    await this.logHistory(ticket.id, userId, from, TicketStatus.RESCHEDULED, note);
    return saved;
  }

  /** Records (or withdraws) the customer approval and the cost ceiling. */
  async setApproval(tenantId: string, userId: string, id: string, dto: ApprovalDto): Promise<MaintenanceTicket> {
    const ticket = await this.getTicket(tenantId, id);
    if (CLOSED_STATUSES.includes(ticket.status)) {
      throw new ConflictException(`A ${ticket.status} ticket cannot be changed`);
    }
    if (dto.maxApprovedCost !== undefined && dto.maxApprovedCost !== null) {
      assertWithinApproval(Number(ticket.totalCost), dto.maxApprovedCost);
      ticket.maxApprovedCost = round(dto.maxApprovedCost, 4);
    }
    ticket.customerApproved = dto.approved;
    ticket.approvedAt = dto.approved ? new Date() : null;
    const saved = await this.ticketRepo.save(ticket);
    const ceiling = ticket.maxApprovedCost != null ? ` (max ${Number(ticket.maxApprovedCost)})` : '';
    await this.logHistory(
      ticket.id,
      userId,
      ticket.status,
      ticket.status,
      `${dto.approved ? 'Customer approved' : 'Approval withdrawn'}${ceiling}${dto.note ? `: ${dto.note}` : ''}`,
    );
    return saved;
  }

  // ---------------------------------------------------------------- lines

  async addPart(tenantId: string, id: string, dto: AddPartDto): Promise<MaintenanceTicket> {
    const ticket = await this.getEditableTicket(tenantId, id);
    const product = await this.productRepo.findOne({ where: { id: dto.productId, tenantId, isActive: true } });
    if (!product) throw new NotFoundException('Product not found or inactive');

    const unitPrice = round(dto.unitPrice ?? Number(product.sellPrice), 4);
    const lineTotal = round(unitPrice * Number(dto.quantity), 4);
    assertWithinApproval(Number(ticket.totalCost) + lineTotal, ticket.maxApprovedCost);

    let reservedQty = 0;
    if (dto.reserve) {
      const warehouseId = await this.warehouseFor(tenantId, ticket);
      reservedQty = await this.stockService.reserve(tenantId, product.id, warehouseId, Number(dto.quantity));
    }
    await this.partRepo.save(
      this.partRepo.create({
        ticketId: ticket.id,
        productId: product.id,
        quantity: dto.quantity,
        unitPrice,
        taxRate: dto.taxRate ?? Number(product.salesTaxRate ?? 0),
        reservedQty,
        unitCost: 0,
        lineTotal,
      }),
    );
    return this.refreshTotal(tenantId, ticket);
  }

  async removePart(tenantId: string, id: string, partId: string): Promise<MaintenanceTicket> {
    const ticket = await this.getEditableTicket(tenantId, id);
    const part = await this.partRepo.findOne({ where: { id: partId, ticketId: ticket.id } });
    if (!part) throw new NotFoundException('Part line not found');
    if (Number(part.reservedQty) > 0) {
      await this.stockService.release(tenantId, part.productId, await this.warehouseFor(tenantId, ticket), Number(part.reservedQty));
    }
    await this.partRepo.delete(part.id);
    return this.refreshTotal(tenantId, ticket);
  }

  async addLabour(tenantId: string, id: string, dto: AddLabourDto): Promise<MaintenanceTicket> {
    const ticket = await this.getEditableTicket(tenantId, id);
    if (dto.serviceProductId) {
      const product = await this.productRepo.findOne({ where: { id: dto.serviceProductId, tenantId } });
      if (!product) throw new NotFoundException('Service product not found');
      if (product.type !== ProductType.SERVICE) {
        throw new BadRequestException('Labour must be invoiced with a service product');
      }
    }
    if (dto.technicianId) await this.getTechnician(tenantId, dto.technicianId);
    const amount = round(dto.amount, 4);
    assertWithinApproval(Number(ticket.totalCost) + amount, ticket.maxApprovedCost);
    await this.labourRepo.save(
      this.labourRepo.create({
        ticketId: ticket.id,
        description: dto.description,
        amount,
        serviceProductId: dto.serviceProductId ?? null,
        technicianId: dto.technicianId ?? ticket.technicianId ?? null,
      }),
    );
    return this.refreshTotal(tenantId, ticket);
  }

  async removeLabour(tenantId: string, id: string, labourId: string): Promise<MaintenanceTicket> {
    const ticket = await this.getEditableTicket(tenantId, id);
    const line = await this.labourRepo.findOne({ where: { id: labourId, ticketId: ticket.id } });
    if (!line) throw new NotFoundException('Labour line not found');
    await this.labourRepo.delete(line.id);
    return this.refreshTotal(tenantId, ticket);
  }

  // ---------------------------------------------------------------- invoicing

  /**
   * Creates (and by default posts) the sales invoice for the parts and labour,
   * links it to the ticket and issues the spare parts. A ticket is invoiced
   * once: Instasoft never wrote the link back, so the same repair could be
   * invoiced again.
   */
  async invoice(tenantId: string, userId: string, id: string, dto: InvoiceTicketDto = {}): Promise<MaintenanceTicket> {
    const ticket = await this.getTicket(tenantId, id);
    if (await this.isInvoiced(tenantId, ticket)) {
      throw new ConflictException('The ticket is already invoiced');
    }
    if (ticket.status === TicketStatus.CANCELLED) {
      throw new ConflictException('A cancelled ticket cannot be invoiced');
    }
    const parts = await this.partRepo.find({ where: { ticketId: ticket.id } });
    const labour = await this.labourRepo.find({ where: { ticketId: ticket.id } });
    if (!parts.length && !labour.length) {
      throw new BadRequestException('The ticket has no parts or labour to invoice');
    }

    const settings = await this.getSettings(tenantId);
    const customerId = ticket.customerId ?? settings.walkInCustomerId;
    if (!customerId) {
      throw new BadRequestException('Walk-in ticket: set a customer on the ticket or a walk-in customer in the maintenance settings');
    }

    const labourLines = [];
    for (const l of labour) {
      const productId = l.serviceProductId ?? settings.defaultLabourProductId;
      if (!productId) {
        throw new BadRequestException('Labour lines need a service product: set the default labour product in the maintenance settings');
      }
      const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
      if (!product) throw new NotFoundException('Labour service product not found');
      labourLines.push({
        productId,
        quantity: 1,
        unitPrice: Number(l.amount),
        taxRate: Number(product.salesTaxRate ?? 0),
        description: l.description,
      });
    }

    const date = dto.date ?? today();
    if (!ticket.partsIssued && parts.length) {
      await this.autoPosting.preflight(tenantId, date, ['cogsAccountId', 'inventoryAccountId']);
    }

    const created = await this.salesInvoices.create(
      tenantId,
      userId,
      {
        customerId,
        date,
        notes: `Repair ${ticket.ticketNumber} - ${ticket.deviceName}`,
        pricesIncludeTax: settings.pricesIncludeTax,
        lines: [
          ...parts.map((p) => ({
            productId: p.productId,
            quantity: Number(p.quantity),
            unitPrice: Number(p.unitPrice),
            taxRate: Number(p.taxRate),
          })),
          ...labourLines,
        ],
      },
      {},
      { skipPriceChecks: true },
    );
    const invoice = dto.post === false ? created : await this.salesInvoices.post(tenantId, userId, created.id);

    if (!ticket.partsIssued) await this.issueParts(tenantId, userId, ticket, date, parts);

    ticket.salesInvoiceId = invoice.id;
    ticket.invoicedAmount = Number(invoice.totalAmount);
    ticket.invoicedAt = new Date();
    const saved = await this.ticketRepo.save(ticket);
    await this.logHistory(ticket.id, userId, ticket.status, ticket.status, `Invoiced ${invoice.invoiceNumber}`);
    return saved;
  }

  // ---------------------------------------------------------------- calendar & reports

  /** Tickets whose appointment (or, without one, promised) date falls in the range. */
  async calendar(tenantId: string, from: string, to: string) {
    const tickets = await this.ticketRepo
      .createQueryBuilder('t')
      .where('t.tenant_id = :tenantId', { tenantId })
      .andWhere('t.status IN (:...open)', { open: OPEN_STATUSES })
      .andWhere('COALESCE(t.appointment_date, t.promised_date) BETWEEN :from AND :to', { from, to })
      .orderBy('COALESCE(t.appointment_date, t.promised_date)', 'ASC')
      .getMany();
    return tickets.map((t) => ({ ...t, calendarDate: t.appointmentDate ?? t.promisedDate }));
  }

  /** Promised date passed and the device is not ready yet. */
  overdue(tenantId: string, asOf = today()): Promise<MaintenanceTicket[]> {
    return this.ticketRepo.find({
      where: {
        tenantId,
        promisedDate: LessThan(asOf),
        status: In(OPEN_STATUSES.filter((s) => s !== TicketStatus.READY)),
      },
      order: { promisedDate: 'ASC' },
    });
  }

  /** Open tickets per technician, split by status. */
  async workload(tenantId: string) {
    const [tickets, technicians] = await Promise.all([
      this.ticketRepo.find({ where: { tenantId, status: In(OPEN_STATUSES) } }),
      this.technicianRepo.find({ where: { tenantId } }),
    ]);
    return summarizeWorkload(tickets, technicians, today());
  }

  async report(tenantId: string, from: string, to: string) {
    const fromTs = new Date(`${from}T00:00:00Z`);
    const toTs = new Date(`${to}T23:59:59.999Z`);
    const [received, delivered, invoiced, technicians] = await Promise.all([
      this.ticketRepo.find({ where: { tenantId, receivedDate: Between(from, to) } }),
      this.ticketRepo.find({ where: { tenantId, status: TicketStatus.DELIVERED, deliveredAt: Between(fromTs, toTs) } }),
      this.ticketRepo.find({ where: { tenantId, invoicedAt: Between(fromTs, toTs) } }),
      this.technicianRepo.find({ where: { tenantId } }),
    ]);
    return buildReport(received, delivered, invoiced, technicians);
  }

  // ---------------------------------------------------------------- helpers

  private async getTicket(tenantId: string, id: string): Promise<MaintenanceTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id, tenantId } });
    if (!ticket) throw new NotFoundException('Repair ticket not found');
    return ticket;
  }

  private async getEditableTicket(tenantId: string, id: string) {
    const ticket = await this.getTicket(tenantId, id);
    assertEditable(ticket.status, await this.isInvoiced(tenantId, ticket));
    return ticket;
  }

  private async getTechnician(tenantId: string, id: string) {
    const technician = await this.technicianRepo.findOne({ where: { id, tenantId } });
    if (!technician) throw new NotFoundException('Technician not found');
    if (!technician.isActive) throw new BadRequestException('Technician is inactive');
    return technician;
  }

  /** A linked invoice counts unless it was cancelled. */
  private async isInvoiced(tenantId: string, ticket: MaintenanceTicket): Promise<boolean> {
    if (!ticket.salesInvoiceId) return false;
    try {
      const invoice = await this.salesInvoices.findById(tenantId, ticket.salesInvoiceId);
      return invoice.status !== SalesInvoiceStatus.CANCELLED;
    } catch (e) {
      if (e instanceof NotFoundException) return false;
      throw e;
    }
  }

  private underWarranty(ticket: MaintenanceTicket): boolean {
    if (!ticket.isWarranty) return false;
    return !ticket.warrantyUntil || ticket.warrantyUntil >= ticket.receivedDate;
  }

  private async warehouseFor(tenantId: string, ticket: MaintenanceTicket): Promise<string> {
    if (ticket.warehouseId) return ticket.warehouseId;
    const settings = await this.getSettings(tenantId);
    if (!settings.defaultWarehouseId) {
      throw new BadRequestException('Set a warehouse on the ticket or a default warehouse in the maintenance settings');
    }
    return settings.defaultWarehouseId;
  }

  private async refreshTotal(tenantId: string, ticket: MaintenanceTicket): Promise<MaintenanceTicket> {
    const [parts, labour] = await Promise.all([
      this.partRepo.find({ where: { ticketId: ticket.id } }),
      this.labourRepo.find({ where: { ticketId: ticket.id } }),
    ]);
    ticket.totalCost = ticketTotal(parts, labour);
    await this.ticketRepo.save(ticket);
    return this.findTicket(tenantId, ticket.id);
  }

  private async releaseReservations(tenantId: string, ticket: MaintenanceTicket) {
    const parts = await this.partRepo.find({ where: { ticketId: ticket.id } });
    const reserved = parts.filter((p) => Number(p.reservedQty) > 0);
    if (!reserved.length) return;
    const warehouseId = await this.warehouseFor(tenantId, ticket);
    for (const part of reserved) {
      await this.stockService.release(tenantId, part.productId, warehouseId, Number(part.reservedQty));
      part.reservedQty = 0;
    }
    await this.partRepo.save(reserved);
  }

  /** Issues the spare parts (consuming their reservations) and posts the cost. */
  private async issueParts(
    tenantId: string,
    userId: string,
    ticket: MaintenanceTicket,
    date: string,
    parts?: MaintenanceTicketPart[],
  ) {
    const lines = parts ?? (await this.partRepo.find({ where: { ticketId: ticket.id } }));
    let cost = 0;
    if (lines.length) {
      const warehouseId = await this.warehouseFor(tenantId, ticket);
      await this.autoPosting.preflight(tenantId, date, ['cogsAccountId', 'inventoryAccountId']);
      for (const part of lines) {
        const issued = await this.stockService.issue(tenantId, userId, {
          productId: part.productId,
          warehouseId,
          quantity: Number(part.quantity),
          releaseReserved: Number(part.reservedQty),
          referenceType: 'maintenance_ticket',
          referenceId: ticket.id,
          description: `Repair ${ticket.ticketNumber}`,
        });
        part.unitCost = issued.unitCost;
        part.reservedQty = 0;
        cost += issued.cost;
      }
      await this.partRepo.save(lines);
    }
    cost = round(cost, 4);
    if (cost > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Spare parts used ${ticket.ticketNumber}`,
        sourceType: 'maintenance_ticket',
        sourceId: ticket.id,
        buildLines: (_s, account) => [
          { accountId: account('cogsAccountId'), debit: cost },
          { accountId: account('inventoryAccountId'), credit: cost },
        ],
      });
    }
    ticket.partsIssued = true;
  }

  private logHistory(
    ticketId: string,
    userId: string,
    fromStatus: TicketStatus | null,
    toStatus: TicketStatus,
    note: string | null,
  ) {
    return this.historyRepo.save(this.historyRepo.create({ ticketId, userId, fromStatus, toStatus, note }));
  }
}

// ---------------------------------------------------------------- pure helpers (unit tested)

export function ticketTotal(
  parts: Pick<MaintenanceTicketPart, 'lineTotal'>[],
  labour: Pick<MaintenanceTicketLabour, 'amount'>[],
): number {
  return round(
    parts.reduce((s, p) => s + Number(p.lineTotal), 0) + labour.reduce((s, l) => s + Number(l.amount), 0),
    4,
  );
}

export function summarizeWorkload(
  tickets: Pick<MaintenanceTicket, 'technicianId' | 'status' | 'promisedDate'>[],
  technicians: Pick<Technician, 'id' | 'nameAr' | 'nameEn'>[],
  asOf: string,
) {
  const rows = new Map<string, { technicianId: string | null; name: string | null; open: number; overdue: number; byStatus: Record<string, number> }>();
  const names = new Map(technicians.map((t) => [t.id, t.nameEn || t.nameAr]));
  for (const t of tickets) {
    const key = t.technicianId ?? 'unassigned';
    const row = rows.get(key) ?? {
      technicianId: t.technicianId ?? null,
      name: t.technicianId ? names.get(t.technicianId) ?? null : null,
      open: 0,
      overdue: 0,
      byStatus: {},
    };
    row.open += 1;
    row.byStatus[t.status] = (row.byStatus[t.status] ?? 0) + 1;
    if (t.promisedDate && t.promisedDate < asOf && t.status !== TicketStatus.READY) row.overdue += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.open - a.open);
}

export function buildReport(
  received: Pick<MaintenanceTicket, 'status'>[],
  delivered: Pick<MaintenanceTicket, 'receivedDate' | 'deliveredAt'>[],
  invoiced: Pick<MaintenanceTicket, 'technicianId' | 'invoicedAmount'>[],
  technicians: Pick<Technician, 'id' | 'nameAr' | 'nameEn'>[],
) {
  const byStatus: Record<string, number> = {};
  for (const t of received) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  const days = delivered
    .filter((t) => t.deliveredAt)
    .map((t) => (+new Date(t.deliveredAt as Date) - +new Date(`${t.receivedDate}T00:00:00Z`)) / DAY_MS);
  const avgTurnaroundDays = days.length ? round(days.reduce((s, d) => s + d, 0) / days.length, 2) : null;

  const names = new Map(technicians.map((t) => [t.id, t.nameEn || t.nameAr]));
  const revenue = new Map<string, { technicianId: string | null; name: string | null; tickets: number; revenue: number }>();
  for (const t of invoiced) {
    const key = t.technicianId ?? 'unassigned';
    const row = revenue.get(key) ?? {
      technicianId: t.technicianId ?? null,
      name: t.technicianId ? names.get(t.technicianId) ?? null : null,
      tickets: 0,
      revenue: 0,
    };
    row.tickets += 1;
    row.revenue = round(row.revenue + Number(t.invoicedAmount), 4);
    revenue.set(key, row);
  }

  return {
    received: received.length,
    byStatus,
    delivered: delivered.length,
    avgTurnaroundDays,
    revenuePerTechnician: [...revenue.values()].sort((a, b) => b.revenue - a.revenue),
    totalRevenue: round([...revenue.values()].reduce((s, r) => s + r.revenue, 0), 4),
  };
}
