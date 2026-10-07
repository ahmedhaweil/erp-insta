import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Warehouse } from '../entities/warehouse.entity';
import { Category } from '../entities/category.entity';
import { Unit } from '../entities/unit.entity';
import { CreateWarehouseDto } from '../dto/create-warehouse.dto';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { CreateUnitDto } from '../dto/create-unit.dto';

/** Warehouses, product categories and units of measure. */
@Injectable()
export class MasterDataService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
  ) {}

  findWarehouses(tenantId: string) {
    return this.warehouseRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async createWarehouse(tenantId: string, dto: CreateWarehouseDto) {
    const existing = await this.warehouseRepo.findOne({ where: { tenantId, code: dto.code } });
    if (existing) throw new ConflictException(`Warehouse code ${dto.code} already exists`);
    return this.warehouseRepo.save(this.warehouseRepo.create({ ...dto, tenantId }));
  }

  async updateWarehouse(tenantId: string, id: string, dto: Partial<CreateWarehouseDto>) {
    const warehouse = await this.warehouseRepo.findOne({ where: { id, tenantId } });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    Object.assign(warehouse, dto);
    return this.warehouseRepo.save(warehouse);
  }

  findCategories(tenantId: string) {
    return this.categoryRepo.find({ where: { tenantId }, order: { level: 'ASC', nameAr: 'ASC' } });
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto) {
    let level = 0;
    if (dto.parentId) {
      const parent = await this.categoryRepo.findOne({ where: { id: dto.parentId, tenantId } });
      if (!parent) throw new NotFoundException('Parent category not found');
      level = parent.level + 1;
    }
    return this.categoryRepo.save(this.categoryRepo.create({ ...dto, tenantId, level }));
  }

  findUnits(tenantId: string) {
    return this.unitRepo.find({ where: { tenantId }, order: { nameAr: 'ASC' } });
  }

  async createUnit(tenantId: string, dto: CreateUnitDto) {
    if (dto.baseUnitId) {
      const base = await this.unitRepo.findOne({ where: { id: dto.baseUnitId, tenantId } });
      if (!base) throw new NotFoundException('Base unit not found');
    }
    return this.unitRepo.save(this.unitRepo.create({ ...dto, tenantId }));
  }
}
