import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoice, SalesInvoiceStatus } from '../entities/sales-invoice.entity';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.entity';
import { Customer } from '../entities/customer.entity';
import { CreateSalesInvoiceDto } from '../dto/create-sales-invoice.dto';

@Injectable()
export class SalesInvoicesService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(SalesInvoiceLine)
    private readonly lineRepo: Repository<SalesInvoiceLine>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreateSalesInvoiceDto,
  ): Promise<SalesInvoice> {
    // Auto-generate invoice number
    const count = await this.invoiceRepo.count({ where: { tenantId } });
    const invoiceNumber = `INV-${String(count + 1).padStart(6, '0')}`;

    // Calculate totals
    const subtotal = dto.lines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
    const taxAmount = dto.lines.reduce((sum, l) => {
      const taxable = Number(l.lineTotal);
      return sum + taxable * (Number(l.taxRate || 0) / 100);
    }, 0);
    const totalAmount = subtotal + taxAmount;

    // Credit limit check
    if (dto.customerId) {
      const customer = await this.customerRepo.findOne({
        where: { id: dto.customerId, tenantId },
      });
      if (customer && Number(customer.creditLimit) > 0) {
        const newBalance = Number(customer.balance) + totalAmount;
        if (newBalance > Number(customer.creditLimit)) {
          throw new BadRequestException(
            `Credit limit exceeded. Limit: ${customer.creditLimit}, Current balance: ${customer.balance}, Invoice: ${totalAmount.toFixed(2)}`,
          );
        }
      }
    }

    const invoice = this.invoiceRepo.create({
      ...dto,
      tenantId,
      invoiceNumber,
      createdBy: userId,
      status: SalesInvoiceStatus.DRAFT,
      subtotal,
      taxAmount,
      totalAmount,
      lines: dto.lines.map((l) => this.lineRepo.create(l)),
    });

    const saved = await this.invoiceRepo.save(invoice);

    // Update customer balance (increase outstanding)
    if (dto.customerId) {
      await this.customerRepo
        .createQueryBuilder()
        .update(Customer)
        .set({ balance: () => `balance + ${totalAmount}` })
        .where('id = :id AND tenant_id = :tenantId', { id: dto.customerId, tenantId })
        .execute();
    }

    return saved;
  }

  async findAll(tenantId: string): Promise<SalesInvoice[]> {
    return this.invoiceRepo.find({
      where: { tenantId },
      relations: ['lines', 'customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<SalesInvoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'customer'],
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    return invoice;
  }

  async markPaid(tenantId: string, id: string): Promise<SalesInvoice> {
    const invoice = await this.findById(tenantId, id);

    if (invoice.status === SalesInvoiceStatus.PAID) {
      throw new ConflictException('Invoice is already fully paid');
    }

    if (invoice.status === SalesInvoiceStatus.CANCELLED) {
      throw new ConflictException('Cancelled invoices cannot be paid');
    }

    invoice.paidAmount = invoice.totalAmount;
    invoice.status = SalesInvoiceStatus.PAID;
    const saved = await this.invoiceRepo.save(invoice);

    // Decrease customer balance on payment
    if (invoice.customerId) {
      await this.customerRepo
        .createQueryBuilder()
        .update(Customer)
        .set({ balance: () => `GREATEST(balance - ${Number(invoice.totalAmount)}, 0)` })
        .where('id = :id AND tenant_id = :tenantId', { id: invoice.customerId, tenantId })
        .execute();
    }

    return saved;
  }
}
