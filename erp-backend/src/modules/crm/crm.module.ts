import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmStage } from './entities/crm-stage.entity';
import { CrmLead } from './entities/crm-lead.entity';
import { CrmActivity } from './entities/crm-activity.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { User } from '@modules/auth/entities/user.entity';
import { CrmStagesService } from './services/crm-stages.service';
import { CrmLeadsService } from './services/crm-leads.service';
import { CrmActivitiesService } from './services/crm-activities.service';
import { CrmReportsService } from './services/crm-reports.service';
import {
  CrmActivitiesController,
  CrmLeadsController,
  CrmReportsController,
  CrmStagesController,
} from './controllers/crm.controller';
import { SalesModule } from '@modules/sales/sales.module';

/** CRM: leads, opportunities, pipeline and activities (إدارة علاقات العملاء). */
@Module({
  imports: [TypeOrmModule.forFeature([CrmStage, CrmLead, CrmActivity, Customer, User]), SalesModule],
  controllers: [CrmStagesController, CrmLeadsController, CrmActivitiesController, CrmReportsController],
  providers: [CrmStagesService, CrmLeadsService, CrmActivitiesService, CrmReportsService],
  exports: [CrmLeadsService, CrmActivitiesService],
})
export class CrmModule {}
