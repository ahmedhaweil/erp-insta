import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrentTenant } from '@common/decorators/current-tenant.decorator';
import { RequirePermissions } from '@common/decorators/require-permissions.decorator';
import { Branch } from '../entities/branch.entity';
import { CreateBranchDto } from '../dto/create-branch.dto';

class UpdateBranchDto extends PartialType(CreateBranchDto) {}

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

  @RequirePermissions({ module: 'settings', screen: 'branches', action: 'update' })
  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
  ) {
    const branch = await this.branchRepo.findOne({ where: { tenantId, id } });
    if (!branch) throw new NotFoundException('Branch not found');
    if (dto.code && dto.code !== branch.code) {
      const existing = await this.branchRepo.findOne({ where: { tenantId, code: dto.code } });
      if (existing) throw new ConflictException(`Branch code ${dto.code} already exists`);
    }
    Object.assign(branch, dto);
    return this.branchRepo.save(branch);
  }
}
