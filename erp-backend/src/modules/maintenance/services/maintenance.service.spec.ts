import { BadRequestException, ConflictException } from '@nestjs/common';
import { buildReport, MaintenanceService, summarizeWorkload, ticketTotal } from './maintenance.service';
import { TicketStatus } from '../entities/maintenance-ticket.entity';
import { ProductType } from '@modules/inventory/entities/product.entity';
import { SalesInvoiceStatus } from '@modules/sales/entities/sales-invoice.entity';

const repo = () => ({
  find: jest.fn(async (): Promise<any[]> => []),
  findOne: jest.fn<Promise<any>, any[]>(),
  save: jest.fn(async (x: any) => (Array.isArray(x) ? x : { id: x.id ?? 'saved-id', ...x })),
  create: jest.fn((x: any) => x),
  delete: jest.fn(),
});

describe('MaintenanceService', () => {
  let tickets: ReturnType<typeof repo>;
  let parts: ReturnType<typeof repo>;
  let labour: ReturnType<typeof repo>;
  let history: ReturnType<typeof repo>;
  let technicians: ReturnType<typeof repo>;
  let settings: ReturnType<typeof repo>;
  let products: ReturnType<typeof repo>;
  let stock: Record<string, jest.Mock>;
  let autoPosting: Record<string, jest.Mock>;
  let invoices: Record<string, jest.Mock>;
  let service: MaintenanceService;

  const baseTicket = () => ({
    id: 'tk1',
    tenantId: 't1',
    ticketNumber: 'RPR-000001',
    deviceName: 'Laptop',
    customerId: 'c1',
    status: TicketStatus.READY,
    previousStatus: null as TicketStatus | null,
    totalCost: 300,
    maxApprovedCost: null as number | null,
    customerApproved: true,
    isWarranty: false,
    receivedDate: '2026-10-01',
    salesInvoiceId: null as string | null,
    partsIssued: false,
    warehouseId: null as string | null,
  });

  beforeEach(() => {
    tickets = repo();
    parts = repo();
    labour = repo();
    history = repo();
    technicians = repo();
    settings = repo();
    products = repo();
    stock = {
      issue: jest.fn(async () => ({ unitCost: 40, cost: 80, lots: [] })),
      reserve: jest.fn(async (_t: string, _p: string, _w: string, q: number) => q),
      release: jest.fn(),
    };
    autoPosting = { post: jest.fn(), preflight: jest.fn() };
    invoices = {
      create: jest.fn(async () => ({ id: 'inv1', invoiceNumber: 'INV-000001', totalAmount: 342 })),
      post: jest.fn(async () => ({ id: 'inv1', invoiceNumber: 'INV-000001', totalAmount: 342, status: 'posted' })),
      findById: jest.fn(async () => ({ id: 'inv1', status: SalesInvoiceStatus.POSTED })),
    };
    service = new MaintenanceService(
      tickets as any,
      parts as any,
      labour as any,
      history as any,
      technicians as any,
      settings as any,
      products as any,
      { next: jest.fn(async () => 'RPR-000001') } as any,
      stock as any,
      autoPosting as any,
      invoices as any,
    );
    settings.findOne.mockResolvedValue({
      tenantId: 't1',
      defaultLabourProductId: 'svc',
      defaultWarehouseId: 'w1',
      pricesIncludeTax: false,
    });
  });

  describe('invoicing', () => {
    beforeEach(() => {
      parts.find.mockResolvedValue([{ id: 'pl1', productId: 'p1', quantity: 2, unitPrice: 100, taxRate: 14, reservedQty: 2 }]);
      labour.find.mockResolvedValue([{ id: 'll1', description: 'Board repair', amount: 100, serviceProductId: null }]);
      products.findOne.mockResolvedValue({ id: 'svc', type: ProductType.SERVICE, salesTaxRate: 14 });
    });

    it('creates and posts one sales invoice with parts and labour, links it and issues the parts', async () => {
      const ticket = baseTicket();
      tickets.findOne.mockResolvedValue(ticket);
      await service.invoice('t1', 'u1', 'tk1');

      const dto = invoices.create.mock.calls[0][2];
      expect(dto.customerId).toBe('c1');
      expect(dto.lines).toEqual([
        { productId: 'p1', quantity: 2, unitPrice: 100, taxRate: 14 },
        { productId: 'svc', quantity: 1, unitPrice: 100, taxRate: 14, description: 'Board repair' },
      ]);
      expect(invoices.post).toHaveBeenCalledWith('t1', 'u1', 'inv1');
      expect(stock.issue).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ productId: 'p1', warehouseId: 'w1', quantity: 2, releaseReserved: 2 }));
      const cogs = autoPosting.post.mock.calls[0][0];
      expect(cogs.buildLines({}, (k: string) => k)).toEqual([
        { accountId: 'cogsAccountId', debit: 80 },
        { accountId: 'inventoryAccountId', credit: 80 },
      ]);
      const saved = tickets.save.mock.calls.at(-1)![0];
      expect(saved.salesInvoiceId).toBe('inv1');
      expect(saved.invoicedAmount).toBe(342);
      expect(saved.partsIssued).toBe(true);
    });

    it('refuses invoicing the same ticket twice', async () => {
      tickets.findOne.mockResolvedValue({ ...baseTicket(), salesInvoiceId: 'inv1' });
      await expect(service.invoice('t1', 'u1', 'tk1')).rejects.toThrow(ConflictException);
      expect(invoices.create).not.toHaveBeenCalled();
    });

    it('allows a new invoice when the linked one was cancelled, without issuing parts again', async () => {
      tickets.findOne.mockResolvedValue({ ...baseTicket(), salesInvoiceId: 'old', partsIssued: true });
      invoices.findById.mockResolvedValue({ id: 'old', status: SalesInvoiceStatus.CANCELLED });
      await service.invoice('t1', 'u1', 'tk1');
      expect(invoices.create).toHaveBeenCalled();
      expect(stock.issue).not.toHaveBeenCalled();
    });

    it('needs a labour service product', async () => {
      tickets.findOne.mockResolvedValue(baseTicket());
      settings.findOne.mockResolvedValue({ tenantId: 't1', defaultLabourProductId: null, defaultWarehouseId: 'w1' });
      await expect(service.invoice('t1', 'u1', 'tk1')).rejects.toThrow(/service product/);
    });

    it('needs a customer for walk-in tickets', async () => {
      tickets.findOne.mockResolvedValue({ ...baseTicket(), customerId: null });
      await expect(service.invoice('t1', 'u1', 'tk1')).rejects.toThrow(/Walk-in/);
    });
  });

  describe('lines and approval', () => {
    it('refuses a part pushing the total above the approved maximum', async () => {
      tickets.findOne.mockResolvedValue({ ...baseTicket(), status: TicketStatus.IN_REPAIR, totalCost: 300, maxApprovedCost: 350 });
      products.findOne.mockResolvedValue({ id: 'p1', sellPrice: 100, salesTaxRate: 14 });
      await expect(service.addPart('t1', 'tk1', { productId: 'p1', quantity: 1 })).rejects.toThrow(BadRequestException);
      expect(parts.save).not.toHaveBeenCalled();
    });

    it('reserves the part quantity in the default warehouse and recomputes the total', async () => {
      const ticket = { ...baseTicket(), status: TicketStatus.IN_REPAIR, totalCost: 0 };
      tickets.findOne.mockResolvedValue(ticket);
      products.findOne.mockResolvedValue({ id: 'p1', sellPrice: 100, salesTaxRate: 14 });
      parts.find.mockResolvedValue([{ lineTotal: 300 }]);
      labour.find.mockResolvedValue([{ amount: 50 }]);
      await service.addPart('t1', 'tk1', { productId: 'p1', quantity: 3, reserve: true });
      expect(stock.reserve).toHaveBeenCalledWith('t1', 'p1', 'w1', 3);
      expect(parts.save.mock.calls[0][0]).toEqual(expect.objectContaining({ lineTotal: 300, reservedQty: 3, taxRate: 14 }));
      expect(ticket.totalCost).toBe(350);
    });

    it('refuses raising the approval ceiling below the current total', async () => {
      tickets.findOne.mockResolvedValue({ ...baseTicket(), totalCost: 300 });
      await expect(service.setApproval('t1', 'u1', 'tk1', { approved: true, maxApprovedCost: 200 })).rejects.toThrow(BadRequestException);
    });
  });

  describe('status changes', () => {
    it('refuses delivering an uninvoiced paid repair', async () => {
      tickets.findOne.mockResolvedValue(baseTicket());
      await expect(service.changeStatus('t1', 'u1', 'tk1', { status: TicketStatus.DELIVERED })).rejects.toThrow(/Invoice/);
    });

    it('delivers a warranty ticket, issuing its parts, and logs the history', async () => {
      const ticket = { ...baseTicket(), isWarranty: true };
      tickets.findOne.mockResolvedValue(ticket);
      parts.find.mockResolvedValue([{ productId: 'p1', quantity: 1, reservedQty: 0 }]);
      await service.changeStatus('t1', 'u1', 'tk1', { status: TicketStatus.DELIVERED, note: 'picked up' });
      expect(stock.issue).toHaveBeenCalled();
      expect(ticket.status).toBe(TicketStatus.DELIVERED);
      expect(history.save.mock.calls[0][0]).toEqual(
        expect.objectContaining({ fromStatus: TicketStatus.READY, toStatus: TicketStatus.DELIVERED, userId: 'u1', note: 'picked up' }),
      );
    });

    it('reschedules then resumes to the parked state', async () => {
      const ticket = { ...baseTicket(), status: TicketStatus.IN_REPAIR, appointmentDate: null };
      tickets.findOne.mockResolvedValue(ticket);
      await service.reschedule('t1', 'u1', 'tk1', { appointmentDate: '2026-10-20' });
      expect(ticket.status).toBe(TicketStatus.RESCHEDULED);
      expect(ticket.previousStatus).toBe(TicketStatus.IN_REPAIR);
      expect(ticket.appointmentDate).toBe('2026-10-20');

      await expect(service.changeStatus('t1', 'u1', 'tk1', { status: TicketStatus.READY })).rejects.toThrow(BadRequestException);
      await service.changeStatus('t1', 'u1', 'tk1', { status: TicketStatus.IN_REPAIR });
      expect(ticket.status).toBe(TicketStatus.IN_REPAIR);
      expect(ticket.previousStatus).toBeNull();
    });

    it('releases reservations on cancel and refuses cancelling an invoiced ticket', async () => {
      const ticket = { ...baseTicket(), status: TicketStatus.IN_REPAIR };
      tickets.findOne.mockResolvedValue(ticket);
      parts.find.mockResolvedValue([{ productId: 'p1', reservedQty: 2 }]);
      await service.changeStatus('t1', 'u1', 'tk1', { status: TicketStatus.CANCELLED });
      expect(stock.release).toHaveBeenCalledWith('t1', 'p1', 'w1', 2);

      tickets.findOne.mockResolvedValue({ ...baseTicket(), salesInvoiceId: 'inv1' });
      await expect(service.changeStatus('t1', 'u1', 'tk1', { status: TicketStatus.CANCELLED })).rejects.toThrow(ConflictException);
    });
  });

  describe('reports', () => {
    it('sums parts and labour', () => {
      expect(ticketTotal([{ lineTotal: 100 }, { lineTotal: 50.5 }] as any, [{ amount: 20 }] as any)).toBe(170.5);
    });

    it('computes turnaround and revenue per technician', () => {
      const r = buildReport(
        [{ status: TicketStatus.DELIVERED }, { status: TicketStatus.DELIVERED }, { status: TicketStatus.IN_REPAIR }] as any,
        [
          { receivedDate: '2026-10-01', deliveredAt: new Date('2026-10-03T00:00:00Z') },
          { receivedDate: '2026-10-01', deliveredAt: new Date('2026-10-05T00:00:00Z') },
        ] as any,
        [
          { technicianId: 'a', invoicedAmount: 100 },
          { technicianId: 'a', invoicedAmount: 50 },
          { technicianId: null, invoicedAmount: 10 },
        ] as any,
        [{ id: 'a', nameAr: 'أحمد', nameEn: 'Ahmed' }] as any,
      );
      expect(r.byStatus).toEqual({ delivered: 2, in_repair: 1 });
      expect(r.avgTurnaroundDays).toBe(3);
      expect(r.revenuePerTechnician[0]).toEqual({ technicianId: 'a', name: 'Ahmed', tickets: 2, revenue: 150 });
      expect(r.totalRevenue).toBe(160);
    });

    it('counts workload and overdue tickets per technician', () => {
      const rows = summarizeWorkload(
        [
          { technicianId: 'a', status: TicketStatus.IN_REPAIR, promisedDate: '2026-10-01' },
          { technicianId: 'a', status: TicketStatus.READY, promisedDate: '2026-10-01' },
          { technicianId: null, status: TicketStatus.RECEIVED, promisedDate: null },
        ] as any,
        [{ id: 'a', nameAr: 'أحمد', nameEn: null }] as any,
        '2026-10-09',
      );
      expect(rows[0]).toEqual(
        expect.objectContaining({ technicianId: 'a', name: 'أحمد', open: 2, overdue: 1 }),
      );
      expect(rows[1]).toEqual(expect.objectContaining({ technicianId: null, open: 1 }));
    });
  });
});
