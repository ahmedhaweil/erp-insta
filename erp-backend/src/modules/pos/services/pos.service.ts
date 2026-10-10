import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PosSession } from '../entities/pos-session.entity';
import { PosOrder, PosOrderStatus, PosPaymentMethod } from '../entities/pos-order.entity';
import { PosOrderLine } from '../entities/pos-order-line.entity';
import { PosTerminal } from '../entities/pos-terminal.entity';
import { PosCashMovement } from '../entities/pos-cash-movement.entity';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { CreatePosOrderDto } from '../dto/create-pos-order.dto';
import {
  CashMovementDto,
  CreateTerminalDto,
  PosCashMovementType,
  RefundLineDto,
  UpdateTerminalDto,
} from '../dto/terminal.dto';
import { Product } from '@modules/inventory/entities/product.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { AutoPostingService, SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { computeLine, computeTotals, round, today } from '@shared/utils/document-totals.util';
import { PromotionsService, currentTime } from '@modules/promotions/services/promotions.service';

/** What the acting user may do beyond the normal cashier permissions. */
export interface PosActor {
  userId: string;
  /** pos/discounts/override: discounts above the terminal limit. */
  canOverrideDiscount?: boolean;
  /** pos/sessions/manage: act on other cashiers' sessions. */
  canManageSessions?: boolean;
}

@Injectable()
export class PosService {
  constructor(
    @InjectRepository(PosSession)
    private readonly sessionRepo: Repository<PosSession>,
    @InjectRepository(PosOrder)
    private readonly orderRepo: Repository<PosOrder>,
    @InjectRepository(PosOrderLine)
    private readonly orderLineRepo: Repository<PosOrderLine>,
    @InjectRepository(PosTerminal)
    private readonly terminalRepo: Repository<PosTerminal>,
    @InjectRepository(PosCashMovement)
    private readonly cashMovementRepo: Repository<PosCashMovement>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly sequenceService: SequenceService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
    @Optional() private readonly promotions?: PromotionsService,
  ) {}

  createTerminal(tenantId: string, dto: CreateTerminalDto): Promise<PosTerminal> {
    return this.terminalRepo.save(this.terminalRepo.create({ ...dto, tenantId }));
  }

  async updateTerminal(tenantId: string, id: string, dto: UpdateTerminalDto): Promise<PosTerminal> {
    const terminal = await this.terminalRepo.findOne({ where: { id, tenantId } });
    if (!terminal) throw new NotFoundException('Terminal not found');
    Object.assign(terminal, dto);
    return this.terminalRepo.save(terminal);
  }

  findTerminals(tenantId: string): Promise<PosTerminal[]> {
    return this.terminalRepo.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async openSession(
    tenantId: string,
    userId: string,
    dto: OpenSessionDto,
  ): Promise<PosSession> {
    const terminal = await this.terminalRepo.findOne({
      where: { id: dto.terminalId, tenantId, isActive: true },
    });
    if (!terminal) throw new NotFoundException('Terminal not found');

    const existingOpen = await this.sessionRepo.findOne({
      where: { terminalId: dto.terminalId, tenantId, status: 'open' },
    });
    if (existingOpen) {
      throw new BadRequestException('Terminal already has an open session');
    }

    if (Number(dto.openingCash ?? 0) < 0) {
      throw new BadRequestException('Opening cash cannot be negative');
    }

    const session = this.sessionRepo.create({
      tenantId,
      terminalId: dto.terminalId,
      userId,
      openedAt: new Date(),
      openingCash: dto.openingCash ?? 0,
      status: 'open',
    });
    return this.sessionRepo.save(session);
  }

  /**
   * Closes the session with a cash count: the expected drawer amount is
   * opening cash plus cash sales minus cash refunds plus cash in minus cash
   * out, and the difference is recorded for the cash control report.
   */
  async closeSession(
    tenantId: string,
    actor: PosActor,
    sessionId: string,
    dto: CloseSessionDto,
  ): Promise<PosSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status === 'closed') {
      throw new BadRequestException('Session is already closed');
    }
    this.assertSessionOwner(session, actor);

    const expectedCash = await this.expectedCash(tenantId, session);
    session.closingCash = dto.closingCash;
    session.expectedCash = expectedCash;
    session.cashDifference = round(Number(dto.closingCash) - expectedCash, 4);
    session.closedAt = new Date();
    session.status = 'closed';
    return this.sessionRepo.save(session);
  }

  /** Cash in/out of the drawer outside sales, posted against a counterpart account. */
  async addCashMovement(
    tenantId: string,
    actor: PosActor,
    sessionId: string,
    dto: CashMovementDto,
  ): Promise<PosCashMovement> {
    const session = await this.openSessionFor(tenantId, sessionId, actor);
    const amount = round(dto.amount, 4);
    if (dto.type === PosCashMovementType.OUT) {
      const available = await this.expectedCash(tenantId, session);
      if (amount > available + 0.0001) {
        throw new BadRequestException(`Only ${available} is expected in the drawer`);
      }
    }
    if (dto.accountId) {
      await this.autoPosting.preflight(tenantId, today(), ['cashAccountId']);
    }

    const movement = await this.cashMovementRepo.save(
      this.cashMovementRepo.create({
        tenantId,
        sessionId,
        type: dto.type,
        amount,
        reason: dto.reason,
        accountId: dto.accountId ?? null,
        createdBy: actor.userId,
      }),
    );

    if (dto.accountId) {
      const counterpart = dto.accountId;
      const isIn = dto.type === PosCashMovementType.IN;
      await this.autoPosting.post({
        tenantId,
        userId: actor.userId,
        journalType: JournalType.CASH,
        date: today(),
        description: `POS cash ${dto.type}: ${dto.reason}`,
        sourceType: 'pos_cash_movement',
        sourceId: movement.id,
        buildLines: (_s, account) => [
          { accountId: account('cashAccountId'), [isIn ? 'debit' : 'credit']: amount },
          { accountId: counterpart, [isIn ? 'credit' : 'debit']: amount },
        ],
      });
    }
    return movement;
  }

  findCashMovements(tenantId: string, sessionId: string): Promise<PosCashMovement[]> {
    return this.cashMovementRepo.find({ where: { tenantId, sessionId }, order: { createdAt: 'ASC' } });
  }

  async createOrder(
    tenantId: string,
    actor: PosActor,
    dto: CreatePosOrderDto,
  ): Promise<PosOrder> {
    if (dto.clientReference) {
      const existing = await this.orderRepo.findOne({
        where: { tenantId, clientReference: dto.clientReference },
        relations: ['lines'],
      });
      if (existing) return existing;
    }

    const session = await this.openSessionFor(tenantId, dto.sessionId, actor);
    const terminal = await this.terminalRepo.findOne({ where: { id: session.terminalId, tenantId } });

    const priced = await this.priceLines(tenantId, dto, terminal, actor);
    const promo = await this.applyPromotions(tenantId, dto, terminal, actor, priced);
    const computed = promo.lines.map((line) => ({ ...computeLine(line), productId: line.productId }));
    const { subtotal, taxAmount, totalAmount } = computeTotals(computed);
    const discount = round(computed.reduce((sum, l) => sum + l.discount, 0), 4);

    const cashAmount = this.cashPortion(dto, totalAmount);
    if (dto.cashReceived != null && cashAmount > 0 && dto.cashReceived < cashAmount) {
      throw new BadRequestException(
        `Cash received (${dto.cashReceived}) is less than the amount due in cash (${cashAmount})`,
      );
    }
    const changeAmount =
      dto.cashReceived != null ? round(dto.cashReceived - cashAmount, 4) : null;

    await this.preflight(tenantId, totalAmount, cashAmount, taxAmount, !!terminal?.warehouseId);

    const orderNumber = await this.sequenceService.next(tenantId, 'pos_order', 'POS');

    const order = this.orderRepo.create({
      tenantId,
      sessionId: dto.sessionId,
      orderNumber,
      customerId: dto.customerId ?? null,
      clientReference: dto.clientReference ?? null,
      subtotal,
      taxAmount,
      totalAmount,
      discount,
      paymentMethod: dto.paymentMethod,
      cashReceived: dto.cashReceived ?? null,
      changeAmount,
      cashAmount,
      status: PosOrderStatus.COMPLETED,
      createdBy: actor.userId,
    } as Partial<PosOrder>);
    const savedOrder = await this.orderRepo.save(order);

    let cost = 0;
    const lines: PosOrderLine[] = [];
    for (const line of computed) {
      let unitCost = 0;
      if (terminal?.warehouseId) {
        const issued = await this.stockService.issue(tenantId, actor.userId, {
          productId: line.productId,
          warehouseId: terminal.warehouseId,
          quantity: line.quantity,
          referenceType: 'pos_order',
          referenceId: savedOrder.id,
          description: `POS ${orderNumber}`,
        });
        cost += issued.cost;
        unitCost = issued.unitCost;
      }
      // POS lines store the tax-included total
      lines.push(
        this.orderLineRepo.create({
          orderId: savedOrder.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
          taxRate: line.taxRate,
          unitCost,
          refundedQty: 0,
          lineTotal: round(line.lineTotal + line.taxAmount, 4),
        }),
      );
    }
    await this.orderLineRepo.save(lines);
    await this.promotions?.recordUsages(tenantId, 'pos_order', savedOrder.id, today(), promo.usages);

    await this.postOrder(tenantId, actor.userId, savedOrder, round(cost, 4), false);

    return this.orderRepo.findOne({
      where: { id: savedOrder.id },
      relations: ['lines'],
    }) as Promise<PosOrder>;
  }

  /**
   * Refunds a POS sale, fully or for some lines/quantities: restocks goods at
   * the cost they were sold at and reverses revenue, VAT and payment
   * proportionally. The sale is marked refunded once every unit is returned.
   */
  async refundOrder(
    tenantId: string,
    actor: PosActor,
    orderId: string,
    sessionId: string,
    refundLines?: RefundLineDto[],
  ): Promise<PosOrder> {
    const original = await this.orderRepo.findOne({
      where: { id: orderId, tenantId },
      relations: ['lines'],
    });
    if (!original) throw new NotFoundException('POS order not found');
    if (original.status !== PosOrderStatus.COMPLETED || original.refundedOrderId) {
      throw new ConflictException('Only completed sales can be refunded');
    }

    const session = await this.openSessionFor(tenantId, sessionId, actor);
    const terminal = await this.terminalRepo.findOne({ where: { id: session.terminalId, tenantId } });

    const selection = this.refundSelection(original, refundLines);
    const share = (line: PosOrderLine, qty: number, value: number) =>
      round((value * qty) / Number(line.quantity), 4);

    let subtotal = 0;
    let tax = 0;
    let total = 0;
    let discount = 0;
    for (const { line, quantity } of selection) {
      const lineTotal = share(line, quantity, Number(line.lineTotal));
      const lineDiscount = share(line, quantity, Number(line.discount));
      const lineNet = round(lineTotal / (1 + Number(line.taxRate) / 100), 4);
      total += lineTotal;
      subtotal += lineNet;
      tax += round(lineTotal - lineNet, 4);
      discount += lineDiscount;
    }
    total = round(total, 4);
    const ratio = Number(original.totalAmount) > 0 ? total / Number(original.totalAmount) : 0;
    const cashRefund = round(Number(original.cashAmount || 0) * ratio, 4);

    await this.preflight(tenantId, total, cashRefund, tax, !!terminal?.warehouseId);
    if (cashRefund > 0) {
      const available = await this.expectedCash(tenantId, session);
      if (cashRefund > available + 0.0001) {
        throw new BadRequestException(
          `The drawer is expected to hold ${available}; cannot refund ${cashRefund} in cash`,
        );
      }
    }

    const orderNumber = await this.sequenceService.next(tenantId, 'pos_order', 'POS');
    const refund = await this.orderRepo.save(
      this.orderRepo.create({
        tenantId,
        sessionId,
        orderNumber,
        customerId: original.customerId,
        subtotal: -round(subtotal, 4),
        taxAmount: -round(tax, 4),
        totalAmount: -total,
        discount: -round(discount, 4),
        paymentMethod: original.paymentMethod,
        cashAmount: -cashRefund,
        status: PosOrderStatus.COMPLETED,
        refundedOrderId: original.id,
        createdBy: actor.userId,
      } as Partial<PosOrder>),
    );

    let cost = 0;
    const refundRows: PosOrderLine[] = [];
    for (const { line, quantity } of selection) {
      refundRows.push(
        this.orderLineRepo.create({
          orderId: refund.id,
          productId: line.productId,
          quantity: -quantity,
          unitPrice: Number(line.unitPrice),
          discount: -share(line, quantity, Number(line.discount)),
          taxRate: Number(line.taxRate),
          unitCost: Number(line.unitCost),
          refundedQty: 0,
          lineTotal: -share(line, quantity, Number(line.lineTotal)),
        }),
      );
      line.refundedQty = round(Number(line.refundedQty) + quantity, 4);

      if (terminal?.warehouseId && (await this.stockService.isStockable(tenantId, line.productId))) {
        const unitCost =
          Number(line.unitCost) > 0
            ? Number(line.unitCost)
            : await this.stockService.getUnitCost(tenantId, line.productId);
        await this.stockService.receive(tenantId, actor.userId, {
          productId: line.productId,
          warehouseId: terminal.warehouseId,
          quantity,
          unitCost,
          referenceType: 'pos_refund',
          referenceId: refund.id,
          description: `POS refund ${orderNumber}`,
        });
        cost += unitCost * quantity;
      }
    }
    await this.orderLineRepo.save([...refundRows, ...original.lines]);

    await this.postOrder(tenantId, actor.userId, refund, round(cost, 4), true);

    if (original.lines.every((l) => Number(l.refundedQty) >= Number(l.quantity) - 0.0001)) {
      original.status = PosOrderStatus.REFUNDED;
      await this.orderRepo.save(original);
    }

    return this.orderRepo.findOne({ where: { id: refund.id }, relations: ['lines'] }) as Promise<PosOrder>;
  }

  async getSessionOrders(
    tenantId: string,
    sessionId: string,
  ): Promise<PosOrder[]> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId },
    });
    if (!session) throw new NotFoundException('Session not found');

    return this.orderRepo.find({
      where: { sessionId, tenantId },
      relations: ['lines'],
      order: { createdAt: 'DESC' },
    });
  }

  /** Session (X/Z) report: sales, refunds, payment split and drawer reconciliation. */
  async getDailySummary(
    tenantId: string,
    sessionId: string,
  ): Promise<{
    totalOrders: number;
    totalSales: number;
    totalTax: number;
    totalDiscount: number;
    totalRefunds: number;
    cashSales: number;
    cardSales: number;
    openingCash: number;
    cashIn: number;
    cashOut: number;
    expectedCash: number;
    closingCash: number | null;
    cashDifference: number | null;
  }> {
    const orders = await this.getSessionOrders(tenantId, sessionId);
    const session = (await this.sessionRepo.findOne({ where: { id: sessionId, tenantId } }))!;
    const movements = await this.findCashMovements(tenantId, sessionId);
    const sales = orders.filter((o) => !o.refundedOrderId);
    const refunds = orders.filter((o) => o.refundedOrderId);
    const totalSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const cashSales = orders.reduce((sum, o) => sum + Number(o.cashAmount || 0), 0);
    const sumMoves = (type: string) =>
      round(movements.filter((m) => m.type === type).reduce((s, m) => s + Number(m.amount), 0), 4);
    return {
      totalOrders: sales.length,
      totalSales: round(totalSales, 4),
      totalTax: round(orders.reduce((sum, o) => sum + Number(o.taxAmount), 0), 4),
      totalDiscount: round(orders.reduce((sum, o) => sum + Number(o.discount), 0), 4),
      totalRefunds: round(-refunds.reduce((sum, o) => sum + Number(o.totalAmount), 0), 4),
      cashSales: round(cashSales, 4),
      cardSales: round(totalSales - cashSales, 4),
      openingCash: Number(session.openingCash),
      cashIn: sumMoves('in'),
      cashOut: sumMoves('out'),
      expectedCash: await this.expectedCash(tenantId, session),
      closingCash: session.closingCash != null ? Number(session.closingCash) : null,
      cashDifference: session.cashDifference != null ? Number(session.cashDifference) : null,
    };
  }

  /**
   * Prices come from the product master unless the cashier types one;
   * a price or discount more than the terminal's limit below the list price
   * needs the discount override permission.
   */
  private async priceLines(
    tenantId: string,
    dto: CreatePosOrderDto,
    terminal: PosTerminal | null,
    actor: PosActor,
  ) {
    const ids = [...new Set(dto.lines.map((l) => l.productId))];
    const products = await this.productRepo.find({ where: { tenantId, id: In(ids), isActive: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const limit = terminal?.maxDiscountPercent != null ? Number(terminal.maxDiscountPercent) : null;

    return dto.lines.map((line) => {
      const product = byId.get(line.productId);
      if (!product) throw new NotFoundException(`Product ${line.productId} not found or inactive`);
      const listPrice = Number(product.sellPrice);
      const unitPrice = line.unitPrice ?? listPrice;
      const taxRate = line.taxRate ?? Number(product.salesTaxRate ?? 0);

      if (limit !== null && listPrice > 0 && !actor.canOverrideDiscount) {
        const listAmount = listPrice * Number(line.quantity);
        const charged = unitPrice * Number(line.quantity) - Number(line.discount ?? 0);
        const discountPct = ((listAmount - charged) / listAmount) * 100;
        if (discountPct > limit + 0.0001) {
          throw new ForbiddenException(
            `Discount of ${round(discountPct, 2)}% on ${product.code} exceeds the ${limit}% allowed on this terminal`,
          );
        }
      }
      return { productId: line.productId, quantity: line.quantity, unitPrice, discount: line.discount, taxRate };
    });
  }

  /**
   * Promotions (campaign discounts added to line discounts, bonus units as
   * zero-price lines issued from stock, invoice discount spread over lines)
   * and the tenant manual discount limit. POS sales are paid at the till,
   * so the payment condition is always cash.
   */
  private async applyPromotions(
    tenantId: string,
    dto: CreatePosOrderDto,
    terminal: PosTerminal | null,
    actor: PosActor,
    priced: Awaited<ReturnType<PosService['priceLines']>>,
  ) {
    if (!this.promotions) return { lines: priced, usages: [] };
    const date = today();
    return this.promotions.applyToDocument(
      tenantId,
      { channel: 'pos', date, time: currentTime(), branchId: terminal?.branchId ?? null, paymentCondition: 'cash' },
      priced.map((l) => ({ ...l, unitPrice: Number(l.unitPrice), taxRate: Number(l.taxRate) })),
      {
        userId: actor.userId,
        applyPromotions: dto.applyPromotions !== false,
        manualInvoiceDiscount: dto.invoiceDiscount,
        canOverrideDiscount: actor.canOverrideDiscount,
      },
    );
  }

  private refundSelection(original: PosOrder, requested?: RefundLineDto[]) {
    const remaining = (l: PosOrderLine) => round(Number(l.quantity) - Number(l.refundedQty || 0), 4);
    if (!requested?.length) {
      const all = original.lines
        .map((line) => ({ line, quantity: remaining(line) }))
        .filter((x) => x.quantity > 0);
      if (!all.length) throw new ConflictException('The sale is already fully refunded');
      return all;
    }

    const pending = new Map(original.lines.map((l) => [l.id, remaining(l)]));
    const selection: { line: PosOrderLine; quantity: number }[] = [];
    for (const req of requested) {
      let qty = round(req.quantity, 4);
      // A product may appear on several lines: take from them in order
      for (const line of original.lines.filter((l) => l.productId === req.productId)) {
        const take = Math.min(qty, pending.get(line.id) ?? 0);
        if (take <= 0) continue;
        selection.push({ line, quantity: take });
        pending.set(line.id, round((pending.get(line.id) ?? 0) - take, 4));
        qty = round(qty - take, 4);
        if (qty <= 0) break;
      }
      if (qty > 0) {
        throw new BadRequestException(
          `Cannot refund ${req.quantity} of product ${req.productId}: more than sold and not yet refunded`,
        );
      }
    }
    return selection;
  }

  private async openSessionFor(tenantId: string, sessionId: string, actor: PosActor) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId, status: 'open' },
    });
    if (!session) throw new NotFoundException('Open session not found');
    this.assertSessionOwner(session, actor);
    return session;
  }

  /** Each cashier is accountable for their own drawer. */
  private assertSessionOwner(session: PosSession, actor: PosActor) {
    if (session.userId !== actor.userId && !actor.canManageSessions) {
      throw new ForbiddenException('This session belongs to another cashier');
    }
  }

  private async expectedCash(tenantId: string, session: PosSession): Promise<number> {
    const orders = await this.orderRepo.find({ where: { sessionId: session.id, tenantId } });
    const movements = await this.findCashMovements(tenantId, session.id);
    const sales = orders.reduce((sum, o) => sum + Number(o.cashAmount || 0), 0);
    const moves = movements.reduce(
      (sum, m) => sum + (m.type === 'in' ? 1 : -1) * Number(m.amount),
      0,
    );
    return round(Number(session.openingCash) + sales + moves, 4);
  }

  private preflight(tenantId: string, total: number, cash: number, tax: number, stocked: boolean) {
    const keys: SettingsAccountKey[] = ['salesAccountId'];
    if (cash > 0) keys.push('cashAccountId');
    if (total - cash > 0) keys.push('bankAccountId');
    if (tax > 0) keys.push('outputTaxAccountId');
    if (stocked) keys.push('cogsAccountId', 'inventoryAccountId');
    return this.autoPosting.preflight(tenantId, today(), keys);
  }

  private cashPortion(dto: CreatePosOrderDto, total: number): number {
    switch (dto.paymentMethod) {
      case PosPaymentMethod.CASH:
        return total;
      case PosPaymentMethod.CARD:
        return 0;
      case PosPaymentMethod.SPLIT: {
        const cash = Number(dto.cashAmount ?? 0);
        if (cash < 0 || cash > total) {
          throw new BadRequestException('Split payment cash amount must be between 0 and the order total');
        }
        return round(cash, 4);
      }
      default:
        return total;
    }
  }

  /** Revenue, output VAT, cash/bank and cost of goods sold for one order. */
  private async postOrder(
    tenantId: string,
    userId: string,
    order: PosOrder,
    cost: number,
    isRefund: boolean,
  ) {
    const total = Math.abs(Number(order.totalAmount));
    const subtotal = Math.abs(Number(order.subtotal));
    const tax = Math.abs(Number(order.taxAmount));
    const cash = Math.abs(Number(order.cashAmount || 0));
    const card = round(total - cash, 4);
    const debit = isRefund ? 'credit' : 'debit';
    const credit = isRefund ? 'debit' : 'credit';

    await this.autoPosting.post({
      tenantId,
      userId,
      journalType: JournalType.SALE,
      date: today(),
      description: `${isRefund ? 'POS refund' : 'POS sale'} ${order.orderNumber}`,
      sourceType: 'pos_order',
      sourceId: order.id,
      buildLines: (_s, account) => {
        const lines = [
          { accountId: account('salesAccountId'), [credit]: subtotal },
        ];
        if (cash > 0) lines.push({ accountId: account('cashAccountId'), [debit]: cash });
        if (card > 0) lines.push({ accountId: account('bankAccountId'), [debit]: card });
        if (tax > 0) lines.push({ accountId: account('outputTaxAccountId'), [credit]: tax });
        if (cost > 0) {
          lines.push({ accountId: account('cogsAccountId'), [debit]: cost });
          lines.push({ accountId: account('inventoryAccountId'), [credit]: cost });
        }
        return lines;
      },
    });
  }
}
