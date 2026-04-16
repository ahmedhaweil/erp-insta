import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaxConfig } from './entities/tax-config.entity';
import { EInvoice } from './entities/e-invoice.entity';
import { TaxService } from './services/tax.service';
import { EInvoiceService } from './services/e-invoice.service';
import { ComplianceController } from './controllers/compliance.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaxConfig, EInvoice])],
  controllers: [ComplianceController],
  providers: [TaxService, EInvoiceService],
  exports: [TaxService, EInvoiceService],
})
export class ComplianceModule {}
