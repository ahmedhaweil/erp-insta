import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PosSession } from '../entities/pos-session.entity';
import { PosOrder, PosOrderStatus, PosPaymentMethod } from '../entities/pos-order.entity';
import { PosOrderLine } from '../entities/pos-order-line.entity';
import { PosTerminal } from '../entities/pos-terminal.entity';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { CreatePosOrderDto } from '../dto/create-pos-order.dto';
import { CreateTerminalDto } from '../dto/terminal.dto';
import { SequenceService } from '@shared/services/sequence.service';
import { StockService } from '@modules/inventory/services/stock.service';
import { AutoPostingService, SettingsAccountKey } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { computeLine, computeTotals, round, today } from '@shared/utils/document-totals.util';

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
    private readonly sequenceService: SequenceService,
    private readonly stockService: StockService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  createTerminal(tenantId: string, dto: CreateTerminalDto): Promise<PosTerminal> {
    return this.terminalRepo.save(this.terminalRepo.create({ ...dto, tenantId }));
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
   * opening cash plus cash sales minus cash refunds, and the difference is
   * recorded for the cash control report.
   */
  async closeSession(
    tenantId: string,
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

    const orders = await this.orderRepo.find({ where: { sessionId, tenantId } });
    const cashMovements = orders.reduce((sum, o) => sum + Number(o.cashAmount || 0), 0);
    const expectedCash = round(Number(session.openingCash) + cashMovements, 4);

    session.closingCash = dto.closingCash;
    session.expectedCash = expectedCash;
    session.cashDifference = round(Number(dto.closingCash) - expectedCash, 4);
    session.closedAt = new Date();
    session.status = 'closed';
    return this.sessionRepo.save(session);
  }

  async createOrder(
    tenantId: string,
    userId: string,
    dto: CreatePosOrderDto,
  ): Promise<PosOrder> {
    const session = await this.sessionRepo.findOne({
      where: { id: dto.sessionId, tenantId, status: 'open' },
    });
    if (!session) throw new NotFoundException('Open session not found');
    const terminal = await this.terminalRepo.findOne({ where: { id: session.terminalId, tenantId } });

    const computed = dto.lines.map((line) => ({ ...computeLine(line), productId: line.productId }));
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
      subtotal,
      taxAmount,
      totalAmount,
      discount,
      paymentMethod: dto.paymentMethod,
      cashReceived: dto.cashReceived ?? null,
      changeAmount,
      cashAmount,
      status: PosOrderStatus.COMPLETED,
      createdBy: userId,
    } as Partial<PosOrder>);
    const savedOrder = await this.orderRepo.save(order);

    // POS lines store the tax-included total
    const lines = computed.map((l) =>
      this.orderLineRepo.create({
        orderId: savedOrder.id,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRate: l.taxRate,
        lineTotal: round(l.lineTotal + l.taxAmount, 4),
      }),
    );
    await this.orderLineRepo.save(lines);

    let cost = 0;
    if (terminal?.warehouseId) {
      for (const line of computed) {
        const issued = await this.stockService.issue(tenantId, userId, {
          productId: line.productId,
          warehouseId: terminal.warehouseId,
          quantity: line.quantity,
          referenceType: 'pos_order',
          referenceId: savedOrder.id,
          description: `POS ${orderNumber}`,
        });
        cost += issued.cost;
      }
    }

    await this.postOrder(tenantId, userId, savedOrder, round(cost, 4), false);

    return this.orderRepo.findOne({
      where: { id: savedOrder.id },
      relations: ['lines'],
    }) as Promise<PosOrder>;
  }

  /** Full refund of a POS order: restocks goods and reverses the sale. */
  async refundOrder(
    tenantId: string,
    userId: string,
    orderId: string,
    sessionId: string,
  ): Promise<PosOrder> {
    const original = await this.orderRepo.findOne({
      where: { id: orderId, tenantId },
      relations: ['lines'],
    });
    if (!original) throw new NotFoundException('POS order not found');
    if (original.status !== PosOrderStatus.COMPLETED || original.refundedOrderId) {
      throw new ConflictException('Only completed sales can be refunded');
    }

    const session = await this.sessionRepo.findOne({ where: { id: sessionId, tenantId, status: 'open' } });
    if (!session) throw new NotFoundException('Open session not found');
    const terminal = await this.terminalRepo.findOne({ where: { id: session.terminalId, tenantId } });
    await this.preflight(
      tenantId,
      Number(original.totalAmount),
      Number(original.cashAmount || 0),
      Number(original.taxAmount),
      !!terminal?.warehouseId,
    );

    const orderNumber = await this.sequenceService.next(tenantId, 'pos_order', 'POS');
    const refund = await this.orderRepo.save(
      this.orderRepo.create({
        tenantId,
        sessionId,
        orderNumber,
        customerId: original.customerId,
        subtotal: -Number(original.subtotal),
        taxAmount: -Number(original.taxAmount),
        totalAmount: -Number(original.totalAmount),
        discount: -Number(original.discount),
        paymentMethod: original.paymentMethod,
        cashAmount: -Number(original.cashAmount || 0),
        status: PosOrderStatus.COMPLETED,
        refundedOrderId: original.id,
        createdBy: userId,
      } as Partial<PosOrder>),
    );
    await this.orderLineRepo.save(
      original.lines.map((l) =>
        this.orderLineRepo.create({
          orderId: refund.id,
          productId: l.productId,
          quantity: -Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discount: -Number(l.discount),
          taxRate: Number(l.taxRate),
          lineTotal: -Number(l.lineTotal),
        }),
      ),
    );

    let cost = 0;
    if (terminal?.warehouseId) {
      for (const line of original.lines) {
        if (!(await this.stockService.isStockable(tenantId, line.productId))) continue;
        const unitCost = await this.stockService.getUnitCost(tenantId, line.productId);
        await this.stockService.receive(tenantId, userId, {
          productId: line.productId,
          warehouseId: terminal.warehouseId,
          quantity: Number(line.quantity),
          unitCost,
          referenceType: 'pos_refund',
          referenceId: refund.id,
          description: `POS refund ${orderNumber}`,
        });
        cost += unitCost * Number(line.quantity);
      }
    }

    await this.postOrder(tenantId, userId, refund, round(cost, 4), true);

    original.status = PosOrderStatus.REFUNDED;
    await this.orderRepo.save(original);

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
  }> {
    const orders = await this.getSessionOrders(tenantId, sessionId);
    const sales = orders.filter((o) => !o.refundedOrderId);
    const refunds = orders.filter((o) => o.refundedOrderId);
    const totalSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const cashSales = orders.reduce((sum, o) => sum + Number(o.cashAmount || 0), 0);
    return {
      totalOrders: sales.length,
      totalSales: round(totalSales, 4),
      totalTax: round(orders.reduce((sum, o) => sum + Number(o.taxAmount), 0), 4),
      totalDiscount: round(orders.reduce((sum, o) => sum + Number(o.discount), 0), 4),
      totalRefunds: round(-refunds.reduce((sum, o) => sum + Number(o.totalAmount), 0), 4),
      cashSales: round(cashSales, 4),
      cardSales: round(totalSales - cashSales, 4),
    };
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
