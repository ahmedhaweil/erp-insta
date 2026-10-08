import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CrmLead, LeadStatus } from '../entities/crm-lead.entity';
import { User } from '@modules/auth/entities/user.entity';
import { PipelineReportQueryDto } from '../dto/crm.dto';
import { CrmStagesService } from './crm-stages.service';
import { round } from '@shared/utils/document-totals.util';

interface Bucket {
  openCount: number;
  pipelineValue: number;
  weightedValue: number;
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
}

const emptyBucket = (): Bucket => ({
  openCount: 0,
  pipelineValue: 0,
  weightedValue: 0,
  wonCount: 0,
  wonValue: 0,
  lostCount: 0,
  lostValue: 0,
});

/** Win rate (%) = won / (won + lost); null when nothing is closed yet. */
export function winRate(won: number, lost: number): number | null {
  return won + lost > 0 ? round((won / (won + lost)) * 100, 2) : null;
}

/** Pipeline analysis (Odoo CRM pipeline / تقرير خط المبيعات). */
@Injectable()
export class CrmReportsService {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stagesService: CrmStagesService,
  ) {}

  async pipeline(tenantId: string, query: PipelineReportQueryDto = {}) {
    const qb = this.leadRepo.createQueryBuilder('l').where('l.tenant_id = :tenantId', { tenantId });
    if (query.from) qb.andWhere('l.created_at::date >= :from', { from: query.from });
    if (query.to) qb.andWhere('l.created_at::date <= :to', { to: query.to });
    if (query.assignedUserId) {
      qb.andWhere('l.assigned_user_id = :assignedUserId', { assignedUserId: query.assignedUserId });
    }
    const leads = await qb.getMany();
    const stages = await this.stagesService.findAll(tenantId, true);

    const totals = emptyBucket();
    const byStage = new Map<string, Bucket>();
    const byUser = new Map<string, Bucket>();
    const lostReasons = new Map<string, number>();

    for (const lead of leads) {
      const revenue = Number(lead.expectedRevenue || 0);
      const stageKey = lead.stageId ?? 'none';
      const userKey = lead.assignedUserId ?? 'unassigned';
      if (!byStage.has(stageKey)) byStage.set(stageKey, emptyBucket());
      if (!byUser.has(userKey)) byUser.set(userKey, emptyBucket());
      for (const bucket of [totals, byStage.get(stageKey)!, byUser.get(userKey)!]) {
        this.add(bucket, lead.status, revenue, Number(lead.probability || 0));
      }
      if (lead.status === LeadStatus.LOST) {
        const reason = lead.lostReason || 'Unspecified';
        lostReasons.set(reason, (lostReasons.get(reason) ?? 0) + 1);
      }
    }

    const userIds = [...byUser.keys()].filter((k) => k !== 'unassigned');
    const users = userIds.length
      ? await this.userRepo.find({ where: { tenantId, id: In(userIds) } })
      : [];
    const userNames = new Map(users.map((u) => [u.id, u.name]));

    const stageRows = stages
      .filter((s) => s.isActive || byStage.has(s.id))
      .map((s) => ({
        stageId: s.id,
        name: s.name,
        nameAr: s.nameAr,
        sequence: s.sequence,
        probability: Number(s.probability),
        isWon: s.isWon,
        ...this.format(byStage.get(s.id) ?? emptyBucket()),
      }));

    return {
      summary: { ...this.format(totals), leadCount: leads.length },
      byStage: stageRows,
      bySalesperson: [...byUser.entries()]
        .map(([userId, bucket]) => ({
          userId: userId === 'unassigned' ? null : userId,
          name: userId === 'unassigned' ? 'Unassigned' : userNames.get(userId) ?? userId,
          ...this.format(bucket),
        }))
        .sort((a, b) => b.weightedValue - a.weightedValue),
      lostReasons: [...lostReasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private add(bucket: Bucket, status: LeadStatus, revenue: number, probability: number) {
    if (status === LeadStatus.OPEN) {
      bucket.openCount += 1;
      bucket.pipelineValue += revenue;
      bucket.weightedValue += (revenue * probability) / 100;
    } else if (status === LeadStatus.WON) {
      bucket.wonCount += 1;
      bucket.wonValue += revenue;
    } else {
      bucket.lostCount += 1;
      bucket.lostValue += revenue;
    }
  }

  private format(bucket: Bucket) {
    return {
      openCount: bucket.openCount,
      pipelineValue: round(bucket.pipelineValue, 4),
      weightedValue: round(bucket.weightedValue, 4),
      wonCount: bucket.wonCount,
      wonValue: round(bucket.wonValue, 4),
      lostCount: bucket.lostCount,
      lostValue: round(bucket.lostValue, 4),
      winRate: winRate(bucket.wonCount, bucket.lostCount),
    };
  }
}
