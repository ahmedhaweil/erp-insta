import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmActivity, ActivityStatus } from '../entities/crm-activity.entity';
import { CrmLead } from '../entities/crm-lead.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { User } from '@modules/auth/entities/user.entity';
import {
  ActivityQueryDto,
  ActivityState,
  CreateActivityDto,
  UpdateActivityDto,
} from '../dto/crm.dto';
import { today } from '@shared/utils/document-totals.util';

export type ActivityView = CrmActivity & { state: ActivityState };

/** Computed state: done/cancelled, or overdue/today/planned from the due date. */
export function activityState(activity: Pick<CrmActivity, 'status' | 'dueDate'>, now = today()): ActivityState {
  if (activity.status === ActivityStatus.DONE) return 'done';
  if (activity.status === ActivityStatus.CANCELLED) return 'cancelled';
  const due = String(activity.dueDate).slice(0, 10);
  if (due < now) return 'overdue';
  if (due === now) return 'today';
  return 'planned';
}

/** Scheduled activities (calls, meetings, tasks, emails) on leads and customers. */
@Injectable()
export class CrmActivitiesService {
  constructor(
    @InjectRepository(CrmActivity)
    private readonly activityRepo: Repository<CrmActivity>,
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(tenantId: string, query: ActivityQueryDto = {}): Promise<ActivityView[]> {
    const qb = this.activityRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .orderBy('a.dueDate', 'ASC')
      .addOrderBy('a.createdAt', 'ASC')
      .take(1000);
    if (query.leadId) qb.andWhere('a.lead_id = :leadId', { leadId: query.leadId });
    if (query.customerId) qb.andWhere('a.customer_id = :customerId', { customerId: query.customerId });
    if (query.assignedUserId) {
      qb.andWhere('a.assigned_user_id = :assignedUserId', { assignedUserId: query.assignedUserId });
    }
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    const now = today();
    switch (query.state) {
      case 'done':
        qb.andWhere('a.status = :s', { s: ActivityStatus.DONE });
        break;
      case 'cancelled':
        qb.andWhere('a.status = :s', { s: ActivityStatus.CANCELLED });
        break;
      case 'overdue':
        qb.andWhere('a.status = :s AND a.due_date < :now', { s: ActivityStatus.PLANNED, now });
        break;
      case 'today':
        qb.andWhere('a.status = :s AND a.due_date = :now', { s: ActivityStatus.PLANNED, now });
        break;
      case 'planned':
        qb.andWhere('a.status = :s', { s: ActivityStatus.PLANNED });
        break;
    }
    const rows = await qb.getMany();
    return rows.map((a) => this.view(a, now));
  }

  /** The current user's open activities (planned, today and overdue by default). */
  my(tenantId: string, userId: string, state?: ActivityState): Promise<ActivityView[]> {
    return this.findAll(tenantId, { assignedUserId: userId, state: state ?? 'planned' });
  }

  async findById(tenantId: string, id: string): Promise<ActivityView> {
    return this.view(await this.get(tenantId, id));
  }

  async create(tenantId: string, userId: string, dto: CreateActivityDto): Promise<ActivityView> {
    if (!dto.leadId && !dto.customerId) {
      throw new BadRequestException('An activity must be linked to a lead or a customer');
    }
    let lead: CrmLead | null = null;
    if (dto.leadId) {
      lead = await this.leadRepo.findOne({ where: { id: dto.leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead not found');
    }
    if (dto.customerId) await this.assertCustomer(tenantId, dto.customerId);
    if (dto.assignedUserId) await this.assertUser(tenantId, dto.assignedUserId);
    const saved = await this.activityRepo.save(
      this.activityRepo.create({
        ...dto,
        tenantId,
        customerId: dto.customerId ?? lead?.customerId ?? undefined,
        assignedUserId: dto.assignedUserId ?? lead?.assignedUserId ?? userId,
        status: ActivityStatus.PLANNED,
        createdBy: userId,
      }),
    );
    return this.view(saved);
  }

  async update(tenantId: string, id: string, dto: UpdateActivityDto): Promise<ActivityView> {
    const activity = await this.get(tenantId, id);
    if (activity.status !== ActivityStatus.PLANNED) {
      throw new BadRequestException('Only planned activities can be edited');
    }
    if (dto.leadId) {
      const lead = await this.leadRepo.findOne({ where: { id: dto.leadId, tenantId } });
      if (!lead) throw new NotFoundException('Lead not found');
    }
    if (dto.customerId) await this.assertCustomer(tenantId, dto.customerId);
    if (dto.assignedUserId) await this.assertUser(tenantId, dto.assignedUserId);
    Object.assign(activity, dto);
    return this.view(await this.activityRepo.save(activity));
  }

  async markDone(tenantId: string, id: string, result?: string): Promise<ActivityView> {
    const activity = await this.get(tenantId, id);
    if (activity.status !== ActivityStatus.PLANNED) {
      throw new BadRequestException(`Activity is already ${activity.status}`);
    }
    activity.status = ActivityStatus.DONE;
    activity.doneAt = new Date();
    if (result !== undefined) activity.result = result;
    return this.view(await this.activityRepo.save(activity));
  }

  async cancel(tenantId: string, id: string): Promise<ActivityView> {
    const activity = await this.get(tenantId, id);
    if (activity.status !== ActivityStatus.PLANNED) {
      throw new BadRequestException(`Activity is already ${activity.status}`);
    }
    activity.status = ActivityStatus.CANCELLED;
    return this.view(await this.activityRepo.save(activity));
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.get(tenantId, id);
    await this.activityRepo.delete({ id, tenantId });
  }

  private async get(tenantId: string, id: string): Promise<CrmActivity> {
    const activity = await this.activityRepo.findOne({ where: { id, tenantId } });
    if (!activity) throw new NotFoundException('Activity not found');
    return activity;
  }

  private view(activity: CrmActivity, now = today()): ActivityView {
    return Object.assign(activity, { state: activityState(activity, now) });
  }

  private async assertCustomer(tenantId: string, id: string): Promise<void> {
    const customer = await this.customerRepo.findOne({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  private async assertUser(tenantId: string, id: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('Assigned user not found');
  }
}
