import { Body, ConflictException, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { Branch } from '../entities/branch.entity';
import { CreateBranchDto } from '../dto/create-branch.dto';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepo: Repository<Branch>,
  ) {}

  @RequirePermissions({ module: 'settings', screen: 'branches', action: 'read' })
  @Get()
  findAll(@CurrentTenant() tenantId: string) {
    return this.branchRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  @RequirePermissions({ module: 'settings', screen: 'branches', action: 'create' })
  @Post()
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateBranchDto) {
    const existing = await this.branchRepo.findOne({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException(`Branch code ${dto.code} already exists`);
    return this.branchRepo.save(this.branchRepo.create({ ...dto, tenantId }));
  }
}
