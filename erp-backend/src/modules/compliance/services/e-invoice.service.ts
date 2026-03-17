import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EInvoice, EInvoiceProvider, EInvoiceStatus } from '../entities/e-invoice.entity';
import { SubmitInvoiceDto } from '../dto/submit-invoice.dto';

@Injectable()
export class EInvoiceService {
  constructor(
    @InjectRepository(EInvoice)
    private readonly eInvoiceRepo: Repository<EInvoice>,
  ) {}

  async submitInvoice(
    tenantId: string,
    dto: SubmitInvoiceDto,
  ): Promise<EInvoice> {
    const invoice = this.eInvoiceRepo.create({
      tenantId,
      invoiceId: dto.invoiceId,
      invoiceType: dto.invoiceType,
      status: EInvoiceStatus.PENDING,
      provider: EInvoiceProvider.ETA,
    });
    return this.eInvoiceRepo.save(invoice);
  }

  async getStatus(tenantId: string, id: string): Promise<EInvoice> {
    const invoice = await this.eInvoiceRepo.findOne({
      where: { id, tenantId },
    });
    if (!invoice) throw new NotFoundException('E-Invoice not found');
    return invoice;
  }

  async findAll(tenantId: string): Promise<EInvoice[]> {
    return this.eInvoiceRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }
}
