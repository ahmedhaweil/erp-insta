import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { Currency } from '@modules/accounting/entities/currency.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { SalesOrder } from '@modules/sales/entities/sales-order.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { PurchaseOrder } from '@modules/purchasing/entities/purchase-order.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Unit } from '@modules/inventory/entities/unit.entity';
import { Warehouse } from '@modules/inventory/entities/warehouse.entity';
import { StockMovement } from '@modules/inventory/entities/stock-movement.entity';
import { TreasuryVoucher } from '@modules/treasury/entities/treasury-voucher.entity';
import { Treasury } from '@modules/treasury/entities/treasury.entity';
import { Cheque } from '@modules/treasury/entities/cheque.entity';
import { Payment } from '@modules/payments/entities/payment.entity';
import { PaymentAllocation } from '@modules/payments/entities/payment-allocation.entity';
import { PosOrder } from '@modules/pos/entities/pos-order.entity';
import { PosSession } from '@modules/pos/entities/pos-session.entity';
import { PosTerminal } from '@modules/pos/entities/pos-terminal.entity';
import { User } from '@modules/auth/entities/user.entity';
import { PayrollRun } from '@modules/hr/entities/payroll-run.entity';
import { PayrollLine } from '@modules/hr/entities/payroll-line.entity';
import { Employee } from '@modules/hr/entities/employee.entity';
import { Department } from '@modules/hr/entities/department.entity';
import { JobTitle } from '@modules/hr/entities/job-title.entity';
import { EInvoice } from '@modules/compliance/entities/e-invoice.entity';
import { EReceipt } from '@modules/compliance/entities/e-receipt.entity';
import { ComplianceSettings } from '@modules/compliance/entities/compliance-settings.entity';
import { PartnerStatementService } from '@modules/reports/services/partner-statement.service';
import { ChequePrintLayout } from './entities/cheque-print-layout.entity';
import { PrintDataService } from './services/print-data.service';
import { PrintingService } from './services/printing.service';
import { ChequeLayoutsService } from './services/cheque-layouts.service';
import { PrintingController } from './controllers/printing.controller';
import { ChequeLayoutsController } from './controllers/cheque-layouts.controller';

/**
 * Printable documents (PDF) with Arabic shaping / RTL support. Reads the
 * source modules' tables read-only; PartnerStatementService (reports) is
 * instantiated here because the reports module does not export it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChequePrintLayout,
      Tenant,
      Branch,
      Currency,
      Account,
      SalesInvoice,
      SalesOrder,
      Customer,
      PurchaseOrder,
      PurchaseInvoice,
      Supplier,
      Product,
      Unit,
      Warehouse,
      StockMovement,
      TreasuryVoucher,
      Treasury,
      Cheque,
      Payment,
      PaymentAllocation,
      PosOrder,
      PosSession,
      PosTerminal,
      User,
      PayrollRun,
      PayrollLine,
      Employee,
      Department,
      JobTitle,
      EInvoice,
      EReceipt,
      ComplianceSettings,
    ]),
  ],
  controllers: [PrintingController, ChequeLayoutsController],
  providers: [PrintDataService, PrintingService, ChequeLayoutsService, PartnerStatementService],
  exports: [PrintingService],
})
export class PrintingModule {}
