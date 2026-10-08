import { CrmReportsService, winRate } from './crm-reports.service';
import { LeadStatus } from '../entities/crm-lead.entity';

describe('CrmReportsService', () => {
  it('computes the pipeline per stage and salesperson with weighted value and win rate', async () => {
    const leads = [
      { stageId: 's1', assignedUserId: 'u1', status: LeadStatus.OPEN, expectedRevenue: 1000, probability: 10 },
      { stageId: 's2', assignedUserId: 'u1', status: LeadStatus.OPEN, expectedRevenue: 2000, probability: 60 },
      { stageId: 's2', assignedUserId: 'u2', status: LeadStatus.OPEN, expectedRevenue: 500, probability: 50 },
      { stageId: 's3', assignedUserId: 'u1', status: LeadStatus.WON, expectedRevenue: 3000, probability: 100 },
      { stageId: 's2', assignedUserId: 'u2', status: LeadStatus.LOST, expectedRevenue: 800, probability: 0, lostReason: 'Price' },
      { stageId: 's1', assignedUserId: 'u2', status: LeadStatus.LOST, expectedRevenue: 0, probability: 0, lostReason: 'Price' },
    ];
    const qb: any = { where: jest.fn(() => qb), andWhere: jest.fn(() => qb), getMany: jest.fn(async () => leads) };
    const service = new CrmReportsService(
      { createQueryBuilder: () => qb } as any,
      { find: jest.fn(async () => [{ id: 'u1', name: 'Ahmed' }, { id: 'u2', name: 'Sara' }]) } as any,
      {
        findAll: jest.fn(async () => [
          { id: 's1', name: 'New', sequence: 10, probability: 10, isWon: false, isActive: true },
          { id: 's2', name: 'Proposition', sequence: 20, probability: 60, isWon: false, isActive: true },
          { id: 's3', name: 'Won', sequence: 30, probability: 100, isWon: true, isActive: true },
        ]),
      } as any,
    );

    const report = await service.pipeline('t1');
    expect(report.summary).toMatchObject({
      openCount: 3,
      pipelineValue: 3500,
      weightedValue: 1550,
      wonCount: 1,
      lostCount: 2,
      winRate: 33.33,
      leadCount: 6,
    });
    expect(report.byStage.find((s) => s.stageId === 's2')).toMatchObject({
      openCount: 2,
      pipelineValue: 2500,
      weightedValue: 1450,
    });
    const ahmed = report.bySalesperson.find((r) => r.userId === 'u1')!;
    expect(ahmed).toMatchObject({ name: 'Ahmed', openCount: 2, weightedValue: 1300, wonValue: 3000, winRate: 100 });
    const sara = report.bySalesperson.find((r) => r.userId === 'u2')!;
    expect(sara.winRate).toBe(0);
    expect(report.lostReasons).toEqual([{ reason: 'Price', count: 2 }]);
  });

  it('has no win rate when nothing is closed', () => {
    expect(winRate(0, 0)).toBeNull();
  });
});
