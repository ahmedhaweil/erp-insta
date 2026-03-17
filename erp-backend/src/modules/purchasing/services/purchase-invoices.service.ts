import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoice, PurchaseInvoiceStatus } from '../entities/purchase-invoice.entity';
import { PurchaseInvoiceLine } from '../entities/purchase-invoice-line.entity';
import { CreatePurchaseInvoiceDto } from '../dto/create-purchase-invoice.dto';

@Injectable()
export class PurchaseInvoicesService {
  constructor(
    @InjectRepository(PurchaseInvoice)
    private readonly invoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(PurchaseInvoiceLine)
    private readonly lineRepo: Repository<PurchaseInvoiceLine>,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseInvoiceDto,
  ): Promise<PurchaseInvoice> {
    const count = await this.invoiceRepo.count({ where: { tenantId } });
    const invoiceNumber = `PINV-${String(count + 1).padStart(6, '0')}`;

    const invoice = this.invoiceRepo.create({
      ...dto,
      tenantId,
      invoiceNumber,
      createdBy: userId,
      status: PurchaseInvoiceStatus.DRAFT,
      lines: dto.lines.map((l) => this.lineRepo.create(l)),
    });

    return this.invoiceRepo.save(invoice);
  }

  async findAll(tenantId: string): Promise<PurchaseInvoice[]> {
    return this.invoiceRepo.find({
      where: { tenantId },
      relations: ['lines', 'supplier'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PurchaseInvoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'supplier'],
    });
    if (!invoice) throw new NotFoundException('Purchase invoice not found');
    return invoice;
  }

  async approve(tenantId: string, id: string): Promise<PurchaseInvoice> {
    const invoice = await this.findById(tenantId, id);

    if (invoice.status !== PurchaseInvoiceStatus.DRAFT) {
      throw new ConflictException('Only draft invoices can be approved');
    }

    invoice.status = PurchaseInvoiceStatus.APPROVED;
    return this.invoiceRepo.save(invoice);
  }

  async markPaid(tenantId: string, id: string): Promise<PurchaseInvoice> {
    const invoice = await this.findById(tenantId, id);

    if (
      invoice.status !== PurchaseInvoiceStatus.APPROVED &&
      invoice.status !== PurchaseInvoiceStatus.PARTIAL
    ) {
      throw new ConflictException('Only approved or partial invoices can be marked as paid');
    }

    invoice.status = PurchaseInvoiceStatus.PAID;
    invoice.paidAmount = Number(invoice.totalAmount);
    return this.invoiceRepo.save(invoice);
  }
}
