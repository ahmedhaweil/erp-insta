import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoice, SalesInvoiceStatus } from '../entities/sales-invoice.entity';
import { SalesInvoiceLine } from '../entities/sales-invoice-line.entity';
import { CreateSalesInvoiceDto } from '../dto/create-sales-invoice.dto';

@Injectable()
export class SalesInvoicesService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly invoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(SalesInvoiceLine)
    private readonly lineRepo: Repository<SalesInvoiceLine>,
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

    return this.invoiceRepo.save(invoice);
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
    return this.invoiceRepo.save(invoice);
  }
}
