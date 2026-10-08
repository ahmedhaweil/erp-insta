import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRule, ApprovalRuleLevel } from './entities/approval-rule.entity';
import { ApprovalAction, ApprovalRequest } from './entities/approval-request.entity';
import { UserRole } from '@modules/auth/entities/user-role.entity';
import { Role } from '@modules/auth/entities/role.entity';
import { ApprovalsService } from './services/approvals.service';
import { ApprovalsController } from './controllers/approvals.controller';

/**
 * Generic approval engine. It depends on nothing but its own tables and the
 * user/role assignments, so purchasing, payments and treasury can import it
 * and register handlers without import cycles.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRule,
      ApprovalRuleLevel,
      ApprovalRequest,
      ApprovalAction,
      UserRole,
      Role,
    ]),
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
