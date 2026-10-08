import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EtaItemCode } from '../entities/eta-item-code.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { UpdateItemCodeDto, UpsertItemCodeDto } from '../dto/item-code.dto';

@Injectable()
export class ItemCodesService {
  constructor(
    @InjectRepository(EtaItemCode)
    private readonly itemCodeRepo: Repository<EtaItemCode>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  findAll(tenantId: string): Promise<EtaItemCode[]> {
    return this.itemCodeRepo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<EtaItemCode> {
    const code = await this.itemCodeRepo.findOne({ where: { id, tenantId } });
    if (!code) throw new NotFoundException('Item code mapping not found');
    return code;
  }

  /** Creates or replaces the mapping of a product. */
  async upsert(tenantId: string, dto: UpsertItemCodeDto): Promise<EtaItemCode> {
    const product = await this.productRepo.findOne({ where: { id: dto.productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    const existing = await this.itemCodeRepo.findOne({ where: { tenantId, productId: dto.productId } });
    const entity = existing || this.itemCodeRepo.create({ tenantId, productId: dto.productId });
    Object.assign(entity, dto);
    return this.itemCodeRepo.save(entity);
  }

  async update(tenantId: string, id: string, dto: UpdateItemCodeDto): Promise<EtaItemCode> {
    const entity = await this.findById(tenantId, id);
    Object.assign(entity, dto);
    return this.itemCodeRepo.save(entity);
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: true }> {
    const entity = await this.findById(tenantId, id);
    await this.itemCodeRepo.remove(entity);
    return { deleted: true };
  }

  async mapForProducts(tenantId: string, productIds: string[]): Promise<Map<string, EtaItemCode>> {
    if (!productIds.length) return new Map();
    const rows = await this.itemCodeRepo.find({ where: { tenantId, productId: In([...new Set(productIds)]) } });
    return new Map(rows.map((r) => [r.productId, r]));
  }
}
