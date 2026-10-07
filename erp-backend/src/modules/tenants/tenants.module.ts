import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { Branch } from './entities/branch.entity';
import { TenantsService } from './services/tenants.service';
import { TenantsController } from './controllers/tenants.controller';
import { BranchesController } from './controllers/branches.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Branch])],
  controllers: [TenantsController, BranchesController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
