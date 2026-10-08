import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { CrmLead, LeadSource, LeadStatus, LeadType } from '../entities/crm-lead.entity';
import { CrmActivity } from '../entities/crm-activity.entity';
import { CrmStage } from '../entities/crm-stage.entity';
import {
  ConvertToCustomerDto,
  CreateLeadDto,
  CreateQuotationDto,
  LeadQueryDto,
  UpdateLeadDto,
} from '../dto/crm.dto';
import { CrmStagesService } from './crm-stages.service';
import { Customer } from '@modules/sales/entities/customer.entity';
import { User } from '@modules/auth/entities/user.entity';
import { CustomersService } from '@modules/sales/services/customers.service';
import { SalesOrdersService } from '@modules/sales/services/sales-orders.service';
import { SalesOrder } from '@modules/sales/entities/sales-order.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { today } from '@shared/utils/document-totals.util';

/**
 * Leads and opportunities (Odoo crm.lead): pipeline stages with
 * probability, won/lost, conversion to customer and to a quotation.
 */
@Injectable()
export class CrmLeadsService {
  constructor(
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
    @InjectRepository(CrmActivity)
    private readonly activityRepo: Repository<CrmActivity>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stagesService: CrmStagesService,
    private readonly customersService: CustomersService,
    private readonly salesOrdersService: SalesOrdersService,
    private readonly sequenceService: SequenceService,
  ) {}

  async findAll(tenantId: string, query: LeadQueryDto = {}): Promise<CrmLead[]> {
    const qb = this.leadRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.stage', 'stage')
      .leftJoinAndSelect('l.customer', 'customer')
      .where('l.tenant_id = :tenantId', { tenantId })
      .orderBy('l.createdAt', 'DESC')
      .take(500);
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.type) qb.andWhere('l.type = :type', { type: query.type });
    if (query.stageId) qb.andWhere('l.stage_id = :stageId', { stageId: query.stageId });
    if (query.assignedUserId) {
      qb.andWhere('l.assigned_user_id = :assignedUserId', { assignedUserId: query.assignedUserId });
    }
    if (query.customerId) qb.andWhere('l.customer_id = :customerId', { customerId: query.customerId });
    if (query.source) qb.andWhere('l.source = :source', { source: query.source });
    if (query.search) {
      const term = `%${query.search}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('l.title ILIKE :term', { term })
            .orWhere('l.contact_name ILIKE :term', { term })
            .orWhere('l.company_name ILIKE :term', { term })
            .orWhere('l.email ILIKE :term', { term })
            .orWhere('l.phone ILIKE :term', { term }),
        ),
      );
    }
    return qb.getMany();
  }

  async findById(tenantId: string, id: string): Promise<CrmLead> {
    const lead = await this.leadRepo.findOne({
      where: { id, tenantId },
      relations: ['stage', 'customer'],
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }

  async create(tenantId: string, userId: string, dto: CreateLeadDto): Promise<CrmLead> {
    const stage = dto.stageId
      ? await this.stagesService.findById(tenantId, dto.stageId)
      : await this.stagesService.defaultStage(tenantId);
    if (dto.customerId) await this.assertCustomer(tenantId, dto.customerId);
    const assignedUserId = dto.assignedUserId ?? userId;
    if (dto.assignedUserId) await this.assertUser(tenantId, dto.assignedUserId);
    if (!dto.customerId && !dto.contactName && !dto.companyName && !dto.email && !dto.phone) {
      throw new BadRequestException('Link a customer or give prospect contact information');
    }

    const leadNumber = await this.sequenceService.next(tenantId, 'crm_lead', 'LEAD');
    const lead = this.leadRepo.create({
      ...dto,
      tenantId,
      leadNumber,
      type: dto.type ?? (dto.customerId ? LeadType.OPPORTUNITY : LeadType.LEAD),
      status: LeadStatus.OPEN,
      stageId: stage.id,
      probability: dto.probability ?? Number(stage.probability),
      expectedRevenue: dto.expectedRevenue ?? 0,
      source: dto.source ?? LeadSource.OTHER,
      assignedUserId,
      createdBy: userId,
    });
    if (stage.isWon) this.applyWon(lead, stage);
    const saved = await this.leadRepo.save(lead);
    return this.findById(tenantId, saved.id);
  }

  async update(tenantId: string, id: string, dto: UpdateLeadDto): Promise<CrmLead> {
    const lead = await this.findById(tenantId, id);
    const { stageId, ...rest } = dto;
    if (rest.customerId) await this.assertCustomer(tenantId, rest.customerId);
    if (rest.assignedUserId) await this.assertUser(tenantId, rest.assignedUserId);
    Object.assign(lead, rest);
    delete (lead as any).stage;
    delete (lead as any).customer;
    await this.leadRepo.save(lead);
    if (stageId && stageId !== lead.stageId) return this.moveStage(tenantId, id, stageId);
    return this.findById(tenantId, id);
  }

  /** Moves the lead in the pipeline; probability follows the stage. */
  async moveStage(tenantId: string, id: string, stageId: string): Promise<CrmLead> {
    const lead = await this.findById(tenantId, id);
    if (lead.status === LeadStatus.LOST) {
      throw new BadRequestException('Lead is lost; restore it before moving it');
    }
    const stage = await this.stagesService.findById(tenantId, stageId);
    if (!stage.isActive) throw new BadRequestException('Pipeline stage is archived');
    lead.stageId = stage.id;
    lead.probability = Number(stage.probability);
    if (stage.isWon) {
      this.applyWon(lead, stage);
    } else if (lead.status === LeadStatus.WON) {
      lead.status = LeadStatus.OPEN;
      lead.closedDate = null as any;
    }
    return this.saveAndReload(tenantId, lead);
  }

  async markWon(tenantId: string, id: string): Promise<CrmLead> {
    const lead = await this.findById(tenantId, id);
    if (lead.status === LeadStatus.WON) throw new BadRequestException('Lead is already won');
    const stage = await this.stagesService.wonStage(tenantId);
    this.applyWon(lead, stage);
    return this.saveAndReload(tenantId, lead);
  }

  async markLost(tenantId: string, id: string, reason: string): Promise<CrmLead> {
    const lead = await this.findById(tenantId, id);
    if (lead.status !== LeadStatus.OPEN) {
      throw new BadRequestException(`Lead is already ${lead.status}`);
    }
    if (!reason?.trim()) throw new BadRequestException('A lost reason is required');
    lead.status = LeadStatus.LOST;
    lead.probability = 0;
    lead.lostReason = reason.trim();
    lead.closedDate = today();
    return this.saveAndReload(tenantId, lead);
  }

  /** Restores a won or lost lead to the open pipeline. */
  async reopen(tenantId: string, id: string): Promise<CrmLead> {
    const lead = await this.findById(tenantId, id);
    if (lead.status === LeadStatus.OPEN) throw new BadRequestException('Lead is already open');
    let stage: CrmStage | null = lead.stage ?? null;
    if (!stage || stage.isWon || !stage.isActive) stage = await this.stagesService.defaultStage(tenantId);
    lead.status = LeadStatus.OPEN;
    lead.stageId = stage.id;
    lead.probability = Number(stage.probability);
    lead.lostReason = null as any;
    lead.closedDate = null as any;
    return this.saveAndReload(tenantId, lead);
  }

  async convertToOpportunity(tenantId: string, id: string): Promise<CrmLead> {
    const lead = await this.findById(tenantId, id);
    if (lead.type === LeadType.OPPORTUNITY) throw new BadRequestException('Already an opportunity');
    lead.type = LeadType.OPPORTUNITY;
    return this.saveAndReload(tenantId, lead);
  }

  /**
   * Creates the customer from the prospect information (through the sales
   * CustomersService) or links an existing one, and makes it an opportunity.
   */
  async convertToCustomer(
    tenantId: string,
    id: string,
    dto: ConvertToCustomerDto = {},
  ): Promise<{ lead: CrmLead; customer: Customer; created: boolean }> {
    const lead = await this.findById(tenantId, id);
    if (lead.status === LeadStatus.LOST) throw new BadRequestException('Lead is lost');
    if (lead.customerId && !dto.customerId) {
      throw new BadRequestException('Lead is already linked to a customer');
    }
    let customer: Customer;
    let created = false;
    if (dto.customerId) {
      customer = await this.assertCustomer(tenantId, dto.customerId);
    } else {
      const name = lead.companyName || lead.contactName || lead.title;
      const code = dto.code ?? (await this.sequenceService.next(tenantId, 'crm_customer', 'CUST'));
      customer = await this.customersService.create(tenantId, {
        code,
        nameAr: dto.nameAr ?? name,
        nameEn: dto.nameEn ?? name,
        phone: lead.phone ?? '',
        email: lead.email ?? undefined,
        address: lead.address ?? undefined,
        city: lead.city ?? undefined,
        country: lead.country ?? undefined,
        taxId: dto.taxId,
        paymentTermDays: dto.paymentTermDays,
        creditLimit: dto.creditLimit,
      });
      created = true;
    }
    lead.customerId = customer.id;
    lead.type = LeadType.OPPORTUNITY;
    return { lead: await this.saveAndReload(tenantId, lead), customer, created };
  }

  /**
   * Creates a draft quotation (sales order) for the opportunity, converting
   * the prospect to a customer first when needed.
   */
  async createQuotation(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreateQuotationDto,
  ): Promise<{ lead: CrmLead; salesOrder: SalesOrder }> {
    let lead = await this.findById(tenantId, id);
    if (lead.status === LeadStatus.LOST) throw new BadRequestException('Lead is lost');
    if (!lead.customerId) lead = (await this.convertToCustomer(tenantId, id)).lead;
    const salesOrder = await this.salesOrdersService.create(tenantId, userId, {
      customerId: lead.customerId,
      date: dto.date ?? today(),
      validityDate: dto.validityDate,
      warehouseId: dto.warehouseId,
      branchId: dto.branchId,
      currencyId: lead.currencyId ?? undefined,
      notes: dto.notes ?? `From ${lead.leadNumber} - ${lead.title}`,
      lines: dto.lines,
    });
    lead.salesOrderId = salesOrder.id;
    lead.type = LeadType.OPPORTUNITY;
    if (!(Number(lead.expectedRevenue) > 0)) lead.expectedRevenue = Number(salesOrder.subtotal);
    return { lead: await this.saveAndReload(tenantId, lead), salesOrder };
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const lead = await this.findById(tenantId, id);
    if (lead.salesOrderId) {
      throw new BadRequestException('Lead has a quotation; mark it lost instead of deleting it');
    }
    await this.activityRepo.delete({ tenantId, leadId: id });
    await this.leadRepo.delete({ id, tenantId });
  }

  private applyWon(lead: CrmLead, stage: CrmStage | null) {
    lead.status = LeadStatus.WON;
    lead.type = LeadType.OPPORTUNITY;
    lead.probability = 100;
    lead.lostReason = null as any;
    lead.closedDate = today();
    if (stage) lead.stageId = stage.id;
  }

  private async saveAndReload(tenantId: string, lead: CrmLead): Promise<CrmLead> {
    delete (lead as any).stage;
    delete (lead as any).customer;
    await this.leadRepo.save(lead);
    return this.findById(tenantId, lead.id);
  }

  private async assertCustomer(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { id, tenantId } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  private async assertUser(tenantId: string, id: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id, tenantId } });
    if (!user) throw new NotFoundException('Assigned user not found');
  }
}
