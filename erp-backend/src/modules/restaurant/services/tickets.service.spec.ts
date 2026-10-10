import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { TicketsService } from './tickets.service';
import { TicketOrderType, TicketStatus } from '../entities/ticket.entity';
import { ModifierType } from '../entities/menu.entity';
import { PosPaymentMethod } from '@modules/pos/entities/pos-order.entity';

let seq = 0;
/** Minimal in-memory repository: equality filters, `In(...)`, other operators match anything. */
function memRepo(rows: any[] = []) {
  const match = (row: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (v === undefined) return true;
      if (v instanceof FindOperator) return v.type === 'in' ? (v.value as any[]).includes(row[k]) : true;
      if (v !== null && typeof v === 'object') return true;
      return row[k] === v;
    });
  return {
    rows,
    find: jest.fn(async (opts?: any) => rows.filter((r) => match(r, opts?.where))),
    findOne: jest.fn(async (opts?: any) => rows.find((r) => match(r, opts?.where)) ?? null),
    create: jest.fn((x: any) => ({ ...x })),
    save: jest.fn(async (x: any) => {
      for (const r of Array.isArray(x) ? x : [x]) {
        if (!r.id) r.id = `id${++seq}`;
        const existing = rows.find((o) => o.id === r.id);
        if (existing) Object.assign(existing, r);
        else rows.push(r);
      }
      return x;
    }),
    delete: jest.fn(async (where: any) => {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1);
    }),
  };
}

describe('TicketsService', () => {
  let tickets: ReturnType<typeof memRepo>;
  let lines: ReturnType<typeof memRepo>;
  let voidLogs: ReturnType<typeof memRepo>;
  let tables: ReturnType<typeof memRepo>;
  let zones: ReturnType<typeof memRepo>;
  let apps: ReturnType<typeof memRepo>;
  let appPrices: ReturnType<typeof memRepo>;
  let modifiers: ReturnType<typeof memRepo>;
  let combos: ReturnType<typeof memRepo>;
  let products: ReturnType<typeof memRepo>;
  let customers: ReturnType<typeof memRepo>;
  let settings: any;
  let kitchen: { dispatch: jest.Mock };
  let pos: { createOrder: jest.Mock };
  let service: TicketsService;

  const waiter = { userId: 'u1' };
  const manager = { userId: 'm1', canVoid: true, canDiscount: true };
  const T = 't1';

  beforeEach(() => {
    seq = 0;
    tickets = memRepo();
    lines = memRepo();
    voidLogs = memRepo();
    tables = memRepo([
      { id: 'tab1', tenantId: T, name: 'T1', isActive: true },
      { id: 'tab2', tenantId: T, name: 'T2', isActive: true },
    ]);
    zones = memRepo([{ id: 'z1', tenantId: T, fee: 15, isActive: true }]);
    apps = memRepo([{ id: 'app1', tenantId: T, isActive: true, commissionPercent: 20 }]);
    appPrices = memRepo([{ tenantId: T, appId: 'app1', productId: 'burger', price: 60 }]);
    modifiers = memRepo([
      { id: 'cheese', tenantId: T, productId: 'burger', type: ModifierType.ADDON, nameAr: 'جبنة', price: 5, stockProductId: 'cheese-slice', stockQuantity: 2, isActive: true },
      { id: 'no-onion', tenantId: T, productId: 'burger', type: ModifierType.WITHOUT, nameAr: 'بدون بصل', price: 1, ingredientProductId: 'onion', isActive: true },
    ]);
    combos = memRepo([
      { id: 'g1', tenantId: T, comboProductId: 'meal', nameAr: 'مشروب', minPicks: 1, maxPicks: 1, sortOrder: 0, items: [{ productId: 'cola', extraPrice: 3, quantity: 1 }] },
    ]);
    products = memRepo([
      { id: 'burger', tenantId: T, code: 'B', sellPrice: 50, salesTaxRate: 14, isActive: true },
      { id: 'meal', tenantId: T, code: 'M', sellPrice: 80, salesTaxRate: 14, isActive: true },
      { id: 'cola', tenantId: T, code: 'C', sellPrice: 10, salesTaxRate: 14, isActive: true },
      { id: 'sc', tenantId: T, code: 'SC', sellPrice: 0, salesTaxRate: 14, isActive: true },
    ]);
    customers = memRepo([{ id: 'c1', tenantId: T, phone: '0100', address: 'Street 1' }]);
    settings = {
      serviceChargePercent: 10,
      serviceChargeProductId: 'sc',
      deliveryFeeProductId: 'sc',
      requireTableForDineIn: true,
      ticketNumberReset: 'daily',
      kdsRedMinutes: 15,
    };
    kitchen = { dispatch: jest.fn(async () => ({ kitchenTickets: [], linesSent: 0 })) };
    pos = { createOrder: jest.fn() };

    // findById loads lines through the relation
    const plainFindOne = tickets.findOne.getMockImplementation()!;
    tickets.findOne.mockImplementation(async (opts: any) => {
      const t = await plainFindOne(opts);
      if (t && opts?.relations?.includes('lines')) t.lines = lines.rows.filter((l) => l.ticketId === t.id);
      return t;
    });

    service = new TicketsService(
      tickets as any,
      lines as any,
      voidLogs as any,
      tables as any,
      zones as any,
      memRepo([{ id: 'd1', tenantId: T, isActive: true }]) as any,
      apps as any,
      appPrices as any,
      modifiers as any,
      combos as any,
      products as any,
      customers as any,
      memRepo() as any,
      { getSettings: jest.fn(async () => settings) } as any,
      kitchen as any,
      { next: jest.fn(async (_t: string, _c: string, prefix: string) => `${prefix}-000007`) } as any,
      pos as any,
    );
  });

  const dineIn = (tableId = 'tab1', ticketLines: any[] = []) =>
    service.create(T, waiter, { orderType: TicketOrderType.DINE_IN, tableId, lines: ticketLines });

  describe('creation rules', () => {
    it('numbers the ticket and computes totals with service charge on dine-in', async () => {
      const t = await dineIn('tab1', [{ productId: 'burger', quantity: 2 }]);
      expect(t.ticketNumber).toBe('REST-000007');
      expect(t.displayNumber).toBe(7);
      expect(Number(t.itemsNet)).toBe(100);
      expect(Number(t.serviceCharge)).toBe(10);
      expect(Number(t.totalAmount)).toBe(125.4);
    });

    it('refuses a second open ticket on an occupied table', async () => {
      await dineIn('tab1');
      await expect(dineIn('tab1')).rejects.toThrow(ConflictException);
    });

    it('requires a table for dine-in when the setting says so', async () => {
      await expect(service.create(T, waiter, { orderType: TicketOrderType.DINE_IN })).rejects.toThrow(BadRequestException);
      settings.requireTableForDineIn = false;
      await expect(service.create(T, waiter, { orderType: TicketOrderType.DINE_IN })).resolves.toBeDefined();
    });

    it('requires customer, address and zone for delivery and defaults the fee to the zone fee', async () => {
      await expect(service.create(T, waiter, { orderType: TicketOrderType.DELIVERY, zoneId: 'z1' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create(T, waiter, { orderType: TicketOrderType.DELIVERY, customerId: 'c1' })).rejects.toThrow(
        BadRequestException,
      );
      const t = await service.create(T, waiter, { orderType: TicketOrderType.DELIVERY, customerId: 'c1', zoneId: 'z1' });
      expect(t.deliveryAddress).toBe('Street 1');
      expect(Number(t.deliveryFee)).toBe(15);
    });

    it('needs an app reference with a delivery app and uses the app price', async () => {
      await expect(
        service.create(T, waiter, { orderType: TicketOrderType.PICKUP, deliveryAppId: 'app1' }),
      ).rejects.toThrow(BadRequestException);
      const t = await service.create(T, waiter, {
        orderType: TicketOrderType.PICKUP,
        deliveryAppId: 'app1',
        appReference: 'TLB-1',
        lines: [{ productId: 'burger', quantity: 1, modifierIds: ['cheese', 'no-onion'] }],
      });
      expect(Number(t.lines[0].unitPrice)).toBe(64); // 60 app price + 5 - 1
      expect(Number(t.serviceCharge)).toBe(0); // no service charge on pickup
    });

    it('merges identical lines and keeps combos as parent + components', async () => {
      const t = await dineIn('tab1', [
        { productId: 'burger', quantity: 1, note: 'well done' },
        { productId: 'burger', quantity: 2, note: 'well done' },
        { productId: 'meal', quantity: 2, comboPicks: [{ groupId: 'g1', productId: 'cola' }] },
      ]);
      const burger = t.lines.filter((l) => l.productId === 'burger');
      expect(burger).toHaveLength(1);
      expect(Number(burger[0].quantity)).toBe(3);
      const meal = t.lines.find((l) => l.productId === 'meal')!;
      const cola = t.lines.find((l) => l.productId === 'cola')!;
      expect(cola.comboParentLineId).toBe(meal.id);
      expect(Number(cola.quantity)).toBe(2);
      expect(Number(cola.unitPrice)).toBe(3);
      expect(Number(t.itemsNet)).toBe(150 + 160 + 6);
    });

    it('refuses discounts without the discount permission', async () => {
      await expect(dineIn('tab1', [{ productId: 'burger', quantity: 1, discount: 5 }])).rejects.toThrow(ForbiddenException);
    });
  });

  describe('void of sent items', () => {
    it('needs the void permission to remove an item already sent and logs it', async () => {
      const t = await dineIn('tab1', [{ productId: 'burger', quantity: 2 }]);
      lines.rows[0].sentQty = 2;
      await expect(service.removeLine(T, waiter, t.id, lines.rows[0].id)).rejects.toThrow(ForbiddenException);

      const after = await service.removeLine(T, manager, t.id, lines.rows[0].id, 'customer left');
      expect(voidLogs.rows).toEqual([
        expect.objectContaining({ ticketId: t.id, productId: 'burger', quantity: 2, unitPrice: 50, amount: 100, reason: 'customer left', userId: 'm1' }),
      ]);
      expect(Number(after.lines[0].quantity)).toBe(0); // kept until the cancellation reaches the kitchen
      expect(Number(after.totalAmount)).toBe(0);
    });

    it('removes an unsent item freely without logging', async () => {
      const t = await dineIn('tab1', [{ productId: 'burger', quantity: 2 }]);
      const after = await service.removeLine(T, waiter, t.id, lines.rows[0].id);
      expect(after.lines).toHaveLength(0);
      expect(voidLogs.rows).toHaveLength(0);
    });

    it('logs only the part of a reduction that was sent', async () => {
      const t = await dineIn('tab1', [{ productId: 'burger', quantity: 5 }]);
      lines.rows[0].sentQty = 3;
      await service.updateLine(T, waiter, t.id, lines.rows[0].id, { quantity: 3 }); // unsent part, fine
      await service.updateLine(T, manager, t.id, lines.rows[0].id, { quantity: 1, reason: 'wrong' });
      expect(voidLogs.rows).toEqual([expect.objectContaining({ quantity: 2 })]);
    });

    it('voids a ticket, logging its items and cancelling what was sent', async () => {
      const t = await dineIn('tab1', [{ productId: 'burger', quantity: 2 }]);
      lines.rows[0].sentQty = 2;
      const v = await service.voidTicket(T, manager, t.id, 'test');
      expect(v.status).toBe(TicketStatus.VOID);
      expect(voidLogs.rows[0]).toEqual(expect.objectContaining({ kind: 'ticket', quantity: 2 }));
      expect(kitchen.dispatch).toHaveBeenCalledWith(
        T,
        'm1',
        expect.anything(),
        [expect.objectContaining({ quantity: 0, sentQty: 2 })],
        { persistLines: false },
      );
      // the table is free again
      await expect(dineIn('tab1')).resolves.toBeDefined();
    });
  });

  describe('transfer, merge, split', () => {
    it('transfers only to a free table', async () => {
      const a = await dineIn('tab1');
      await dineIn('tab2');
      await expect(service.transfer(T, a.id, 'tab2')).rejects.toThrow(ConflictException);
      tickets.rows.find((x) => x.tableId === 'tab2')!.status = TicketStatus.PAID;
      const moved = await service.transfer(T, a.id, 'tab2');
      expect(moved.tableId).toBe('tab2');
    });

    it('merges A into B: lines moved, A voided as merged', async () => {
      const a = await dineIn('tab1', [{ productId: 'burger', quantity: 1 }]);
      const b = await dineIn('tab2', [{ productId: 'cola', quantity: 2 }]);
      const merged = await service.merge(T, waiter, a.id, b.id);
      expect(merged.lines).toHaveLength(2);
      expect(Number(merged.itemsNet)).toBe(70);
      const source = tickets.rows.find((x) => x.id === a.id);
      expect(source.status).toBe(TicketStatus.VOID);
      expect(source.mergedIntoId).toBe(b.id);
      expect(Number(source.totalAmount)).toBe(0);
    });

    it('splits selected quantities to a new ticket on the same table', async () => {
      const a = await dineIn('tab1', [{ productId: 'burger', quantity: 3 }]);
      lines.rows[0].sentQty = 3;
      const { source, split } = await service.split(T, waiter, a.id, { lines: [{ lineId: lines.rows[0].id, quantity: 1 }] });
      expect(split.tableId).toBe('tab1');
      expect(split.splitFromId).toBe(a.id);
      expect(Number(split.lines[0].quantity)).toBe(1);
      expect(Number(split.lines[0].sentQty)).toBe(1);
      expect(Number(source.lines[0].quantity)).toBe(2);
      expect(Number(source.lines[0].sentQty)).toBe(2);
      expect(Number(source.itemsNet)).toBe(100);
      expect(Number(split.itemsNet)).toBe(50);
      await expect(
        service.split(T, waiter, a.id, { lines: [{ lineId: lines.rows[0].id, quantity: 2 }] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('payment', () => {
    it('records the sale through the POS with service charge, combo and addon stock lines', async () => {
      const t = await dineIn('tab1', [
        { productId: 'burger', quantity: 2, modifierIds: ['cheese'] },
        { productId: 'meal', quantity: 1, comboPicks: [{ groupId: 'g1', productId: 'cola' }] },
      ]);
      pos.createOrder.mockImplementation(async () => ({ id: 'po1', totalAmount: tickets.rows[0].totalAmount }));

      const res = await service.pay(T, waiter, t.id, { sessionId: 's1', paymentMethod: PosPaymentMethod.CASH });
      const [, actor, dto, options] = pos.createOrder.mock.calls[0];
      expect(actor).toEqual({ userId: 'u1', canManageSessions: undefined });
      expect(dto.clientReference).toBe(`restaurant-ticket-${t.id}`);
      expect(dto.applyPromotions).toBe(false);
      expect(dto.lines).toEqual([
        { productId: 'burger', quantity: 2, unitPrice: 55, discount: 0, taxRate: 14 },
        { productId: 'cheese-slice', quantity: 4, unitPrice: 0, discount: 0, taxRate: 0 },
        { productId: 'meal', quantity: 1, unitPrice: 80, discount: 0, taxRate: 14 },
        { productId: 'cola', quantity: 1, unitPrice: 3, discount: 0, taxRate: 14 },
        { productId: 'sc', quantity: 1, unitPrice: 19.3, discount: 0, taxRate: 14 },
      ]);
      expect(options).toEqual({ trustedPrices: true, skipStockLines: [2] });
      expect(res.ticket.status).toBe(TicketStatus.PAID);
      expect(res.ticket.posOrderId).toBe('po1');
      expect(kitchen.dispatch).toHaveBeenCalled(); // unsent items go to the kitchen first
    });

    it('cannot pay a ticket twice', async () => {
      const t = await dineIn('tab1', [{ productId: 'burger', quantity: 1 }]);
      pos.createOrder.mockImplementation(async () => ({ id: 'po1', totalAmount: tickets.rows[0].totalAmount }));
      await service.pay(T, waiter, t.id, { sessionId: 's1', paymentMethod: PosPaymentMethod.CARD });
      await expect(
        service.pay(T, waiter, t.id, { sessionId: 's1', paymentMethod: PosPaymentMethod.CARD }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
