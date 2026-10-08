import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrmStage } from '../entities/crm-stage.entity';
import { CrmLead } from '../entities/crm-lead.entity';
import { CreateStageDto, UpdateStageDto } from '../dto/crm.dto';

export const DEFAULT_STAGES: Partial<CrmStage>[] = [
  { name: 'New', nameAr: 'جديد', sequence: 10, probability: 10 },
  { name: 'Qualified', nameAr: 'مؤهل', sequence: 20, probability: 30 },
  { name: 'Proposition', nameAr: 'عرض سعر', sequence: 30, probability: 60 },
  { name: 'Negotiation', nameAr: 'تفاوض', sequence: 40, probability: 80 },
  { name: 'Won', nameAr: 'تم الفوز', sequence: 50, probability: 100, isWon: true },
];

/** Pipeline stages per tenant; a default pipeline is created on first use. */
@Injectable()
export class CrmStagesService {
  constructor(
    @InjectRepository(CrmStage)
    private readonly stageRepo: Repository<CrmStage>,
    @InjectRepository(CrmLead)
    private readonly leadRepo: Repository<CrmLead>,
  ) {}

  async findAll(tenantId: string, includeInactive = false): Promise<CrmStage[]> {
    await this.ensureDefaults(tenantId);
    const where: any = { tenantId };
    if (!includeInactive) where.isActive = true;
    return this.stageRepo.find({ where, order: { sequence: 'ASC', createdAt: 'ASC' } });
  }

  async findById(tenantId: string, id: string): Promise<CrmStage> {
    const stage = await this.stageRepo.findOne({ where: { id, tenantId } });
    if (!stage) throw new NotFoundException('Pipeline stage not found');
    return stage;
  }

  /** First active stage that is not a won stage (where new leads start). */
  async defaultStage(tenantId: string): Promise<CrmStage> {
    const stages = await this.findAll(tenantId);
    const stage = stages.find((s) => !s.isWon) ?? stages[0];
    if (!stage) throw new BadRequestException('No active pipeline stage is configured');
    return stage;
  }

  async wonStage(tenantId: string): Promise<CrmStage | null> {
    const stages = await this.findAll(tenantId);
    return stages.find((s) => s.isWon) ?? null;
  }

  async create(tenantId: string, dto: CreateStageDto): Promise<CrmStage> {
    await this.ensureDefaults(tenantId);
    let sequence = dto.sequence;
    if (sequence === undefined) {
      const last = await this.stageRepo.findOne({ where: { tenantId }, order: { sequence: 'DESC' } });
      sequence = (last?.sequence ?? 0) + 10;
    }
    return this.stageRepo.save(
      this.stageRepo.create({
        tenantId,
        name: dto.name,
        nameAr: dto.nameAr,
        sequence,
        probability: dto.probability ?? (dto.isWon ? 100 : 0),
        isWon: dto.isWon ?? false,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async update(tenantId: string, id: string, dto: UpdateStageDto): Promise<CrmStage> {
    const stage = await this.findById(tenantId, id);
    Object.assign(stage, dto);
    return this.stageRepo.save(stage);
  }

  /** Deletes an unused stage, or archives it when leads still reference it. */
  async remove(tenantId: string, id: string): Promise<{ deleted: boolean; archived: boolean }> {
    const stage = await this.findById(tenantId, id);
    const used = await this.leadRepo.count({ where: { tenantId, stageId: id } });
    if (used > 0) {
      stage.isActive = false;
      await this.stageRepo.save(stage);
      return { deleted: false, archived: true };
    }
    await this.stageRepo.delete({ id, tenantId });
    return { deleted: true, archived: false };
  }

  async ensureDefaults(tenantId: string): Promise<void> {
    const count = await this.stageRepo.count({ where: { tenantId } });
    if (count > 0) return;
    await this.stageRepo.save(
      DEFAULT_STAGES.map((s) => this.stageRepo.create({ ...s, tenantId, isActive: true })),
    );
  }
}
