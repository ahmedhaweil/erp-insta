import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PriceList } from '../entities/price-list.entity';
import { PriceListRule } from '../entities/price-list-rule.entity';
import { CustomerCategory } from '../entities/customer-category.entity';
import {
  CreateCustomerCategoryDto,
  CreatePriceListDto,
  PriceListRuleDto,
  UpdateCustomerCategoryDto,
  UpdatePriceListDto,
} from '../dto/price-list.dto';

/** Price list and customer category master data. */
@Injectable()
export class PriceListsService {
  constructor(
    @InjectRepository(PriceList)
    private readonly listRepo: Repository<PriceList>,
    @InjectRepository(PriceListRule)
    private readonly ruleRepo: Repository<PriceListRule>,
    @InjectRepository(CustomerCategory)
    private readonly categoryRepo: Repository<CustomerCategory>,
  ) {}

  async create(tenantId: string, dto: CreatePriceListDto): Promise<PriceList> {
    this.assertDates(dto.validFrom, dto.validTo);
    const { rules, ...header } = dto;
    return this.listRepo.save(
      this.listRepo.create({
        ...header,
        tenantId,
        rules: (rules ?? []).map((r) => this.buildRule(r)),
      }),
    );
  }

  findAll(tenantId: string): Promise<PriceList[]> {
    return this.listRepo.find({
      where: { tenantId },
      relations: ['rules'],
      order: { name: 'ASC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<PriceList> {
    const list = await this.listRepo.findOne({ where: { id, tenantId }, relations: ['rules'] });
    if (!list) throw new NotFoundException('Price list not found');
    return list;
  }

  /** Updates the header; `rules`, when given, replace every rule of the list. */
  async update(tenantId: string, id: string, dto: UpdatePriceListDto): Promise<PriceList> {
    const list = await this.findById(tenantId, id);
    const { rules, ...header } = dto;
    Object.assign(list, header);
    this.assertDates(list.validFrom, list.validTo);
    if (rules) {
      await this.ruleRepo.delete({ priceListId: list.id });
      list.rules = rules.map((r) => this.buildRule(r, list.id));
    } else {
      delete (list as Partial<PriceList>).rules;
    }
    await this.listRepo.save(list);
    return this.findById(tenantId, id);
  }

  async addRule(tenantId: string, id: string, dto: PriceListRuleDto): Promise<PriceList> {
    const list = await this.findById(tenantId, id);
    await this.ruleRepo.save(this.buildRule(dto, list.id));
    return this.findById(tenantId, id);
  }

  async removeRule(tenantId: string, id: string, ruleId: string): Promise<PriceList> {
    const list = await this.findById(tenantId, id);
    const result = await this.ruleRepo.delete({ id: ruleId, priceListId: list.id });
    if (!result.affected) throw new NotFoundException('Price list rule not found');
    return this.findById(tenantId, id);
  }

  // ------------------------------------------------- customer categories

  async createCategory(tenantId: string, dto: CreateCustomerCategoryDto): Promise<CustomerCategory> {
    const duplicate = await this.categoryRepo.findOne({ where: { tenantId, code: dto.code } });
    if (duplicate) throw new ConflictException(`Customer category ${dto.code} already exists`);
    if (dto.priceListId) await this.findById(tenantId, dto.priceListId);
    return this.categoryRepo.save(this.categoryRepo.create({ ...dto, tenantId }));
  }

  findCategories(tenantId: string): Promise<CustomerCategory[]> {
    return this.categoryRepo.find({ where: { tenantId }, order: { code: 'ASC' } });
  }

  async updateCategory(
    tenantId: string,
    id: string,
    dto: UpdateCustomerCategoryDto,
  ): Promise<CustomerCategory> {
    const category = await this.categoryRepo.findOne({ where: { id, tenantId } });
    if (!category) throw new NotFoundException('Customer category not found');
    if (dto.priceListId) await this.findById(tenantId, dto.priceListId);
    Object.assign(category, dto);
    return this.categoryRepo.save(category);
  }

  private buildRule(dto: PriceListRuleDto, priceListId?: string): PriceListRule {
    this.assertDates(dto.validFrom, dto.validTo);
    return this.ruleRepo.create({
      ...dto,
      ...(priceListId ? { priceListId } : {}),
      productId: dto.productId ?? null,
      categoryId: dto.productId ? null : dto.categoryId ?? null,
      minQuantity: dto.minQuantity ?? 0,
    });
  }

  private assertDates(from?: string | null, to?: string | null): void {
    if (from && to && from > to) {
      throw new BadRequestException('validFrom must be on or before validTo');
    }
  }
}
