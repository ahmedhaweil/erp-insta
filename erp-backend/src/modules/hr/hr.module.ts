import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Department } from './entities/department.entity';
import { JobTitle } from './entities/job-title.entity';
import { WorkSchedule } from './entities/work-schedule.entity';
import { PublicHoliday } from './entities/public-holiday.entity';
import { Employee } from './entities/employee.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { LeaveType } from './entities/leave-type.entity';
import { LeaveRequest } from './entities/leave-request.entity';
import { EmployeeLoan } from './entities/employee-loan.entity';
import { LoanInstallment } from './entities/loan-installment.entity';
import { PayrollAdjustment } from './entities/payroll-adjustment.entity';
import { PayrollRun } from './entities/payroll-run.entity';
import { PayrollLine } from './entities/payroll-line.entity';
import { HrSettings } from './entities/hr-settings.entity';
import { LeaveEncashment } from './entities/leave-encashment.entity';
import { OvertimeRequest } from './entities/overtime-request.entity';
import { EosProvision, EosProvisionLine } from './entities/eos-provision.entity';
import { FinalSettlement } from './entities/final-settlement.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { CostCenter } from '@modules/accounting/entities/cost-center.entity';
import { PayrollLockService } from './services/payroll-lock.service';
import { OvertimeService } from './services/overtime.service';
import { EndOfServiceService } from './services/end-of-service.service';
import { OvertimeController } from './controllers/overtime.controller';
import { EndOfServiceController } from './controllers/end-of-service.controller';
import { SelfServiceController } from './controllers/self-service.controller';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { User } from '@modules/auth/entities/user.entity';
import { AccountingModule } from '@modules/accounting/accounting.module';
import { HrSettingsService } from './services/hr-settings.service';
import { HrOrganizationService } from './services/hr-organization.service';
import { EmployeesService } from './services/employees.service';
import { LeavesService } from './services/leaves.service';
import { AttendanceService } from './services/attendance.service';
import { LoansService } from './services/loans.service';
import { PayrollService } from './services/payroll.service';
import { HrSetupController } from './controllers/hr-setup.controller';
import { EmployeesController } from './controllers/employees.controller';
import { AttendanceController } from './controllers/attendance.controller';
import { LeavesController } from './controllers/leaves.controller';
import { LoansController } from './controllers/loans.controller';
import { PayrollController } from './controllers/payroll.controller';

/** HR, attendance, leaves, employee loans and Egyptian/Saudi payroll. */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Department,
      JobTitle,
      WorkSchedule,
      PublicHoliday,
      Employee,
      AttendanceRecord,
      LeaveType,
      LeaveRequest,
      EmployeeLoan,
      LoanInstallment,
      PayrollAdjustment,
      PayrollRun,
      PayrollLine,
      HrSettings,
      LeaveEncashment,
      OvertimeRequest,
      EosProvision,
      EosProvisionLine,
      FinalSettlement,
      Account,
      CostCenter,
      Branch,
      User,
    ]),
    AccountingModule,
  ],
  controllers: [
    HrSetupController,
    EmployeesController,
    AttendanceController,
    LeavesController,
    LoansController,
    PayrollController,
    OvertimeController,
    EndOfServiceController,
    SelfServiceController,
  ],
  providers: [
    HrSettingsService,
    HrOrganizationService,
    EmployeesService,
    LeavesService,
    AttendanceService,
    LoansService,
    PayrollService,
    PayrollLockService,
    OvertimeService,
    EndOfServiceService,
  ],
  exports: [EmployeesService, PayrollService],
})
export class HrModule {}
