import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Warehouse } from '../entities/warehouse.entity';
import { Category } from '../entities/category.entity';
import { Unit } from '../entities/unit.entity';
import { CreateWarehouseDto, UpdateWarehouseDto } from '../dto/create-warehouse.dto';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/create-category.dto';
import { CreateUnitDto, UpdateUnitDto } from '../dto/create-unit.dto';

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

  async updateWarehouse(tenantId: string, id: string, dto: UpdateWarehouseDto) {
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

  /** Renames or re-parents a category; levels of the moved subtree follow. */
  async updateCategory(tenantId: string, id: string, dto: UpdateCategoryDto) {
    const category = await this.categoryRepo.findOne({ where: { id, tenantId } });
    if (!category) throw new NotFoundException('Category not found');
    const all = await this.categoryRepo.find({ where: { tenantId } });
    if (dto.parentId !== undefined && dto.parentId !== category.parentId) {
      if (dto.parentId) {
        const parent = all.find((c) => c.id === dto.parentId);
        if (!parent) throw new NotFoundException('Parent category not found');
        // Refuse moving a category under itself or one of its descendants
        for (let cur: Category | undefined = parent; cur; cur = all.find((c) => c.id === cur!.parentId)) {
          if (cur.id === id) throw new BadRequestException('A category cannot be moved under itself');
        }
      }
    }
    Object.assign(category, dto);
    const parentLevel = category.parentId ? all.find((c) => c.id === category.parentId)!.level : -1;
    const shift = parentLevel + 1 - category.level;
    category.level = parentLevel + 1;
    await this.categoryRepo.save(category);
    if (shift !== 0) {
      const descendants = (rootId: string): Category[] =>
        all.filter((c) => c.parentId === rootId).flatMap((c) => [c, ...descendants(c.id)]);
      const moved = descendants(id).map((c) => Object.assign(c, { level: c.level + shift }));
      if (moved.length) await this.categoryRepo.save(moved);
    }
    return category;
  }

  async updateUnit(tenantId: string, id: string, dto: UpdateUnitDto) {
    const unit = await this.unitRepo.findOne({ where: { id, tenantId } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (dto.baseUnitId) {
      if (dto.baseUnitId === id) throw new BadRequestException('A unit cannot be its own base unit');
      const base = await this.unitRepo.findOne({ where: { id: dto.baseUnitId, tenantId } });
      if (!base) throw new NotFoundException('Base unit not found');
    }
    Object.assign(unit, dto);
    return this.unitRepo.save(unit);
  }
}
