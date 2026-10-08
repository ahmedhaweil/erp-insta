import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaxConfig } from './entities/tax-config.entity';
import { EInvoice } from './entities/e-invoice.entity';
import { EReceipt } from './entities/e-receipt.entity';
import { ComplianceSettings } from './entities/compliance-settings.entity';
import { EtaItemCode } from './entities/eta-item-code.entity';
import { ComplianceParty } from './entities/compliance-party.entity';
import { ComplianceChain } from './entities/compliance-chain.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Currency } from '@modules/accounting/entities/currency.entity';
import { PosOrder } from '@modules/pos/entities/pos-order.entity';
import { PosSession } from '@modules/pos/entities/pos-session.entity';
import { TaxService } from './services/tax.service';
import { EInvoiceService } from './services/e-invoice.service';
import { EReceiptService } from './services/e-receipt.service';
import { ComplianceSettingsService } from './services/compliance-settings.service';
import { ItemCodesService } from './services/item-codes.service';
import { ComplianceChainService } from './services/compliance-chain.service';
import { DocumentSourceService } from './services/document-source.service';
import { EtaInvoiceService } from './services/eta-invoice.service';
import { ZatcaInvoiceService } from './services/zatca-invoice.service';
import { CompliancePollerService } from './services/compliance-poller.service';
import { EtaAuthService } from './eta/eta-auth.service';
import { EtaApiClient } from './eta/eta-api.client';
import { ExternalSignerService } from './eta/external-signer.service';
import { ZatcaApiClient } from './zatca/zatca-api.client';
import { COMPLIANCE_HTTP_CLIENT, FetchComplianceHttpClient } from './http/compliance-http.client';
import { ComplianceController } from './controllers/compliance.controller';
import { EInvoicesController } from './controllers/e-invoices.controller';
import { EReceiptsController } from './controllers/e-receipts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TaxConfig,
      EInvoice,
      EReceipt,
      ComplianceSettings,
      EtaItemCode,
      ComplianceParty,
      ComplianceChain,
      // Read-only access to the source documents.
      SalesInvoice,
      Customer,
      Product,
      Currency,
      PosOrder,
      PosSession,
    ]),
  ],
  controllers: [ComplianceController, EInvoicesController, EReceiptsController],
  providers: [
    { provide: COMPLIANCE_HTTP_CLIENT, useClass: FetchComplianceHttpClient },
    TaxService,
    ComplianceSettingsService,
    ItemCodesService,
    ComplianceChainService,
    DocumentSourceService,
    EtaAuthService,
    EtaApiClient,
    ExternalSignerService,
    ZatcaApiClient,
    EtaInvoiceService,
    ZatcaInvoiceService,
    EInvoiceService,
    EReceiptService,
    CompliancePollerService,
  ],
  exports: [TaxService, EInvoiceService, EReceiptService, ComplianceSettingsService],
})
export class ComplianceModule {}
