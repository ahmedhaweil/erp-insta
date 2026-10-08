import { BadRequestException } from '@nestjs/common';
import { CrmLeadsService } from './crm-leads.service';
import { LeadStatus, LeadType } from '../entities/crm-lead.entity';

describe('CrmLeadsService', () => {
  let service: CrmLeadsService;
  let lead: any;
  let leadRepo: Record<string, jest.Mock>;
  let customersService: Record<string, jest.Mock>;
  let salesOrdersService: Record<string, jest.Mock>;
  const stages: Record<string, any> = {
    new: { id: 'new', name: 'New', probability: 10, isWon: false, isActive: true },
    prop: { id: 'prop', name: 'Proposition', probability: 60, isWon: false, isActive: true },
    won: { id: 'won', name: 'Won', probability: 100, isWon: true, isActive: true },
  };

  beforeEach(() => {
    lead = null;
    leadRepo = {
      create: jest.fn((l) => ({ ...l })),
      save: jest.fn(async (l) => (lead = { id: 'lead-1', ...lead, ...l })),
      findOne: jest.fn(async () => (lead ? { ...lead, stage: stages[lead.stageId] } : null)),
      delete: jest.fn(),
    };
    customersService = {
      create: jest.fn(async (_t, dto) => ({ id: 'cust-1', ...dto })),
    };
    salesOrdersService = {
      create: jest.fn(async (_t, _u, dto) => ({ id: 'so-1', subtotal: 1500, ...dto })),
    };
    const stagesService = {
      findById: jest.fn(async (_t, id) => stages[id]),
      defaultStage: jest.fn(async () => stages.new),
      wonStage: jest.fn(async () => stages.won),
    };
    service = new CrmLeadsService(
      leadRepo as any,
      { delete: jest.fn() } as any,
      { findOne: jest.fn(async ({ where }) => ({ id: where.id })) } as any,
      { findOne: jest.fn(async ({ where }) => ({ id: where.id })) } as any,
      stagesService as any,
      customersService as any,
      salesOrdersService as any,
      { next: jest.fn().mockResolvedValue('LEAD-000001') } as any,
    );
  });

  const createLead = () =>
    service.create('t1', 'u1', {
      title: 'ERP for Nile Foods',
      companyName: 'Nile Foods',
      contactName: 'Mona',
      phone: '0100',
      expectedRevenue: 1000,
    });

  it('creates a lead in the first stage with its probability and the creator as salesperson', async () => {
    const created = await createLead();
    expect(created).toMatchObject({
      stageId: 'new',
      probability: 10,
      status: LeadStatus.OPEN,
      type: LeadType.LEAD,
      assignedUserId: 'u1',
      leadNumber: 'LEAD-000001',
    });
  });

  it('requires a customer or prospect contact information', async () => {
    await expect(service.create('t1', 'u1', { title: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moving to a stage applies its probability; a won stage wins the lead', async () => {
    await createLead();
    expect((await service.moveStage('t1', 'lead-1', 'prop')).probability).toBe(60);
    const won = await service.moveStage('t1', 'lead-1', 'won');
    expect(won).toMatchObject({ status: LeadStatus.WON, probability: 100, type: LeadType.OPPORTUNITY });
    expect(won.closedDate).toBeTruthy();
  });

  it('marks lost with a reason and can be restored', async () => {
    await createLead();
    await expect(service.markLost('t1', 'lead-1', ' ')).rejects.toBeInstanceOf(BadRequestException);
    const lost = await service.markLost('t1', 'lead-1', 'Price too high');
    expect(lost).toMatchObject({ status: LeadStatus.LOST, probability: 0, lostReason: 'Price too high' });
    await expect(service.moveStage('t1', 'lead-1', 'prop')).rejects.toBeInstanceOf(BadRequestException);
    const reopened = await service.reopen('t1', 'lead-1');
    expect(reopened).toMatchObject({ status: LeadStatus.OPEN, probability: 10, lostReason: null });
  });

  it('converts the prospect to a customer through the customers service', async () => {
    await createLead();
    const { customer, created, lead: updated } = await service.convertToCustomer('t1', 'lead-1');
    expect(created).toBe(true);
    expect(customersService.create).toHaveBeenCalledWith('t1', expect.objectContaining({
      nameAr: 'Nile Foods', nameEn: 'Nile Foods', phone: '0100',
    }));
    expect(updated).toMatchObject({ customerId: customer.id, type: LeadType.OPPORTUNITY });
    await expect(service.convertToCustomer('t1', 'lead-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a draft quotation, converting to a customer first', async () => {
    await service.create('t1', 'u1', { title: 'Deal', contactName: 'Ali' });
    const { lead: updated, salesOrder } = await service.createQuotation('t1', 'u1', 'lead-1', {
      lines: [{ productId: 'p1', quantity: 3, unitPrice: 500 }],
    });
    expect(salesOrdersService.create).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({ customerId: 'cust-1' }));
    expect(updated).toMatchObject({ salesOrderId: salesOrder.id, expectedRevenue: 1500 });
  });
});
