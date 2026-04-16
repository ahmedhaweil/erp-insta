import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PurchaseOrder, PurchaseOrderStatus } from '../entities/purchase-order.entity';
import { PurchaseOrderLine } from '../entities/purchase-order-line.entity';
import { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import { PurchaseReceivedEvent } from '../events/purchase-received.event';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderLine)
    private readonly lineRepo: Repository<PurchaseOrderLine>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrder> {
    const count = await this.orderRepo.count({ where: { tenantId } });
    const orderNumber = `PO-${String(count + 1).padStart(6, '0')}`;

    const order = this.orderRepo.create({
      ...dto,
      tenantId,
      orderNumber,
      createdBy: userId,
      status: PurchaseOrderStatus.DRAFT,
      lines: dto.lines.map((l) => this.lineRepo.create(l)),
    });

    return this.orderRepo.save(order);
  }

  async findAll(tenantId: string): Promise<PurchaseOrder[]> {
    return this.orderRepo.find({
      where: { tenantId },
      relations: ['lines', 'supplier'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.orderRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'supplier'],
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  async confirm(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException('Only draft orders can be confirmed');
    }

    order.status = PurchaseOrderStatus.CONFIRMED;
    const saved = await this.orderRepo.save(order);

    this.eventEmitter.emit(
      'purchase.received',
      new PurchaseReceivedEvent(
        tenantId,
        userId,
        order.id,
        order.orderNumber,
        Number(order.totalAmount),
      ),
    );

    return saved;
  }

  async cancel(tenantId: string, id: string): Promise<PurchaseOrder> {
    const order = await this.findById(tenantId, id);

    if (order.status === PurchaseOrderStatus.CANCELLED) {
      throw new ConflictException('Order is already cancelled');
    }
    if (order.status === PurchaseOrderStatus.RECEIVED) {
      throw new ConflictException('Received orders cannot be cancelled');
    }

    order.status = PurchaseOrderStatus.CANCELLED;
    return this.orderRepo.save(order);
  }
}
