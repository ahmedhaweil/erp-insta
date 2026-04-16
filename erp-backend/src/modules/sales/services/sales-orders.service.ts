import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesOrder, SalesOrderStatus } from '../entities/sales-order.entity';
import { SalesOrderLine } from '../entities/sales-order-line.entity';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { OrderConfirmedEvent } from '../events/order-confirmed.event';

@Injectable()
export class SalesOrdersService {
  constructor(
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    @InjectRepository(SalesOrderLine)
    private readonly lineRepo: Repository<SalesOrderLine>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreateSalesOrderDto,
  ): Promise<SalesOrder> {
    // Auto-generate order number
    const count = await this.orderRepo.count({ where: { tenantId } });
    const orderNumber = `SO-${String(count + 1).padStart(6, '0')}`;

    // Calculate totals
    const subtotal = dto.lines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
    const taxAmount = dto.lines.reduce((sum, l) => {
      const taxable = Number(l.lineTotal);
      return sum + taxable * (Number(l.taxRate || 0) / 100);
    }, 0);
    const totalAmount = subtotal + taxAmount;

    const order = this.orderRepo.create({
      ...dto,
      tenantId,
      orderNumber,
      createdBy: userId,
      status: SalesOrderStatus.DRAFT,
      subtotal,
      taxAmount,
      totalAmount,
      lines: dto.lines.map((l) => this.lineRepo.create(l)),
    });

    return this.orderRepo.save(order);
  }

  async findAll(tenantId: string): Promise<SalesOrder[]> {
    return this.orderRepo.find({
      where: { tenantId },
      relations: ['lines', 'customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SalesOrder> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'customer'],
    });
    if (!order) throw new NotFoundException('Sales order not found');
    return order;
  }

  async confirm(tenantId: string, userId: string, id: string): Promise<SalesOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new ConflictException('Only draft orders can be confirmed');
    }

    order.status = SalesOrderStatus.CONFIRMED;
    const saved = await this.orderRepo.save(order);

    this.eventEmitter.emit(
      'order.confirmed',
      new OrderConfirmedEvent(
        tenantId,
        userId,
        order.id,
        order.orderNumber,
        Number(order.totalAmount),
      ),
    );

    return saved;
  }

  async cancel(tenantId: string, id: string): Promise<SalesOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status === SalesOrderStatus.CANCELLED) {
      throw new ConflictException('Order is already cancelled');
    }

    if (order.status === SalesOrderStatus.DELIVERED) {
      throw new ConflictException('Delivered orders cannot be cancelled');
    }

    order.status = SalesOrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }
}
