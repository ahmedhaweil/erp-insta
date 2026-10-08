import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportJob } from './entities/import-job.entity';
import { DataImportService } from './services/data-import.service';
import { DataImportController } from './controllers/data-import.controller';
import { ProductsImporter } from './importers/products.importer';
import { CustomersImporter, SuppliersImporter } from './importers/partners.importer';
import { AccountsImporter } from './importers/accounts.importer';
import { EmployeesImporter } from './importers/employees.importer';
import { OpeningStockImporter } from './importers/opening-stock.importer';
import {
  OpeningCustomerBalancesImporter,
  OpeningSupplierBalancesImporter,
} from './importers/opening-balances.importer';
import { Product } from '@modules/inventory/entities/product.entity';
import { Category } from '@modules/inventory/entities/category.entity';
import { Unit } from '@modules/inventory/entities/unit.entity';
import { ProductUnit } from '@modules/inventory/entities/product-unit.entity';
import { Warehouse } from '@modules/inventory/entities/warehouse.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { Department } from '@modules/hr/entities/department.entity';
import { JobTitle } from '@modules/hr/entities/job-title.entity';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { SalesModule } from '@modules/sales/sales.module';
import { PurchasingModule } from '@modules/purchasing/purchasing.module';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { HrModule } from '@modules/hr/hr.module';

/**
 * Data onboarding: bilingual templates, two-phase imports (validate, then
 * commit all-or-nothing) and exports of master data and opening balances.
 * Writes go through the owning modules' public services; other tables are
 * only read.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ImportJob,
      Product,
      Category,
      Unit,
      ProductUnit,
      Warehouse,
      Stock,
      Customer,
      Supplier,
      Account,
      Branch,
      Department,
      JobTitle,
    ]),
    InventoryModule,
    SalesModule,
    PurchasingModule,
    AccountingModule,
    HrModule,
  ],
  controllers: [DataImportController],
  providers: [
    DataImportService,
    ProductsImporter,
    CustomersImporter,
    SuppliersImporter,
    AccountsImporter,
    EmployeesImporter,
    OpeningStockImporter,
    OpeningCustomerBalancesImporter,
    OpeningSupplierBalancesImporter,
  ],
  exports: [DataImportService],
})
export class DataImportModule {}
