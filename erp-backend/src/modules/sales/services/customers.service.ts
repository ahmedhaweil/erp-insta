import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { CreateCustomerDto } from '../dto/create-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  async create(tenantId: string, dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customerRepo.create({ ...dto, tenantId });
    return this.customerRepo.save(customer);
  }

  async findAll(tenantId: string): Promise<Customer[]> {
    return this.customerRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.customerRepo.findOne({
      where: { id, tenantId },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateCustomerDto>): Promise<Customer> {
    const customer = await this.findById(tenantId, id);
    Object.assign(customer, dto);
    return this.customerRepo.save(customer);
  }
}
