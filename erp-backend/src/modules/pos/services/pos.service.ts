import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PosSession } from '../entities/pos-session.entity';
import { PosOrder } from '../entities/pos-order.entity';
import { PosOrderLine } from '../entities/pos-order-line.entity';
import { PosTerminal } from '../entities/pos-terminal.entity';
import { OpenSessionDto } from '../dto/open-session.dto';
import { CloseSessionDto } from '../dto/close-session.dto';
import { CreatePosOrderDto } from '../dto/create-pos-order.dto';

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
  ) {}

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

    session.closingCash = dto.closingCash;
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

    const lines = dto.lines.map((line) => {
      const discount = line.discount ?? 0;
      const taxRate = line.taxRate ?? 0;
      const subtotal = line.quantity * line.unitPrice - discount;
      const lineTotal = subtotal + subtotal * (taxRate / 100);
      return this.orderLineRepo.create({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount,
        taxRate,
        lineTotal,
      });
    });

    const subtotal = lines.reduce(
      (sum, l) => sum + l.quantity * l.unitPrice - l.discount,
      0,
    );
    const taxAmount = lines.reduce(
      (sum, l) => sum + (l.quantity * l.unitPrice - l.discount) * (l.taxRate / 100),
      0,
    );
    const totalAmount = subtotal + taxAmount;

    const orderNumber = `POS-${Date.now()}`;
    const changeAmount =
      dto.cashReceived != null ? dto.cashReceived - totalAmount : null;

    const order = this.orderRepo.create({
      tenantId,
      sessionId: dto.sessionId,
      orderNumber,
      customerId: dto.customerId ?? null,
      subtotal,
      taxAmount,
      totalAmount,
      discount: 0,
      paymentMethod: dto.paymentMethod,
      cashReceived: dto.cashReceived ?? null,
      changeAmount,
      createdBy: userId,
    });
    const savedOrder = await this.orderRepo.save(order);

    for (const line of lines) {
      line.orderId = savedOrder.id;
    }
    await this.orderLineRepo.save(lines);

    return this.orderRepo.findOne({
      where: { id: savedOrder.id },
      relations: ['lines'],
    });
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
  }> {
    const orders = await this.getSessionOrders(tenantId, sessionId);
    return {
      totalOrders: orders.length,
      totalSales: orders.reduce((sum, o) => sum + Number(o.totalAmount), 0),
      totalTax: orders.reduce((sum, o) => sum + Number(o.taxAmount), 0),
      totalDiscount: orders.reduce((sum, o) => sum + Number(o.discount), 0),
    };
  }
}
