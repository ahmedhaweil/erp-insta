import { BadRequestException } from '@nestjs/common';
import { CrmActivitiesService, activityState } from './crm-activities.service';
import { ActivityStatus, ActivityType } from '../entities/crm-activity.entity';

describe('CrmActivitiesService', () => {
  it('computes overdue / today / planned / done states', () => {
    const now = '2026-05-10';
    expect(activityState({ status: ActivityStatus.PLANNED, dueDate: '2026-05-09' }, now)).toBe('overdue');
    expect(activityState({ status: ActivityStatus.PLANNED, dueDate: '2026-05-10' }, now)).toBe('today');
    expect(activityState({ status: ActivityStatus.PLANNED, dueDate: '2026-05-11' }, now)).toBe('planned');
    expect(activityState({ status: ActivityStatus.DONE, dueDate: '2026-05-01' }, now)).toBe('done');
    expect(activityState({ status: ActivityStatus.CANCELLED, dueDate: '2026-05-01' }, now)).toBe('cancelled');
  });

  describe('lifecycle', () => {
    let service: CrmActivitiesService;
    let stored: any;

    beforeEach(() => {
      stored = null;
      const repo = {
        create: jest.fn((a) => a),
        save: jest.fn(async (a) => (stored = { id: 'act-1', ...a })),
        findOne: jest.fn(async () => stored && { ...stored }),
      };
      service = new CrmActivitiesService(
        repo as any,
        { findOne: jest.fn(async () => ({ id: 'lead-1', customerId: 'cust-1', assignedUserId: 'sales-1' })) } as any,
        { findOne: jest.fn(async ({ where }) => ({ id: where.id })) } as any,
        { findOne: jest.fn(async ({ where }) => ({ id: where.id })) } as any,
      );
    });

    it('requires a lead or customer', async () => {
      await expect(
        service.create('t1', 'u1', { type: ActivityType.CALL, subject: 'x', dueDate: '2026-01-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('inherits customer and salesperson from the lead, and is marked done once', async () => {
      const created = await service.create('t1', 'u1', {
        type: ActivityType.MEETING,
        subject: 'Demo',
        dueDate: '2000-01-01',
        leadId: 'lead-1',
      });
      expect(created).toMatchObject({ customerId: 'cust-1', assignedUserId: 'sales-1', state: 'overdue' });
      const done = await service.markDone('t1', 'act-1', 'Interested');
      expect(done).toMatchObject({ status: ActivityStatus.DONE, result: 'Interested', state: 'done' });
      await expect(service.markDone('t1', 'act-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
