import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { CreateProductDto } from '../dto/create-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
  ) {}

  async create(tenantId: string, dto: CreateProductDto): Promise<Product> {
    const product = this.productRepo.create({ ...dto, tenantId });
    return this.productRepo.save(product);
  }

  async findAll(tenantId: string): Promise<Product[]> {
    return this.productRepo.find({
      where: { tenantId },
      order: { code: 'ASC' },
      relations: ['category', 'unit'],
    });
  }

  async findById(tenantId: string, id: string): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id, tenantId },
      relations: ['category', 'unit'],
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateProductDto>): Promise<Product> {
    const product = await this.findById(tenantId, id);
    Object.assign(product, dto);
    return this.productRepo.save(product);
  }
}
