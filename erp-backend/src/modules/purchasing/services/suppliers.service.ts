import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from '../entities/supplier.entity';
import { CreateSupplierDto } from '../dto/create-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
  ) {}

  async create(tenantId: string, dto: CreateSupplierDto): Promise<Supplier> {
    const existing = await this.supplierRepo.findOne({
      where: { tenantId, code: dto.code },
    });
    if (existing) {
      throw new ConflictException('Supplier code already exists');
    }

    const supplier = this.supplierRepo.create({ ...dto, tenantId });
    return this.supplierRepo.save(supplier);
  }

  async findAll(tenantId: string): Promise<Supplier[]> {
    return this.supplierRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Supplier> {
    const supplier = await this.supplierRepo.findOne({
      where: { id, tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async update(
    tenantId: string,
    id: string,
    dto: Partial<CreateSupplierDto>,
  ): Promise<Supplier> {
    const supplier = await this.findById(tenantId, id);
    Object.assign(supplier, dto);
    return this.supplierRepo.save(supplier);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const supplier = await this.findById(tenantId, id);
    await this.supplierRepo.remove(supplier);
  }
}
