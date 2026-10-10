import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { CustomerAddress } from '../entities/customer-address.entity';
import { CreateCustomerDto } from '../dto/create-customer.dto';
import { CreateCustomerAddressDto, UpdateCustomerAddressDto } from '../dto/customer-extras.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @Optional()
    @InjectRepository(CustomerAddress)
    private readonly addressRepo?: Repository<CustomerAddress>,
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

  /** Blocks (rejects) a customer: no new orders, invoices or POS sales. */
  async block(tenantId: string, id: string, reason: string): Promise<Customer> {
    const customer = await this.findById(tenantId, id);
    customer.isBlocked = true;
    customer.blockReason = reason;
    return this.customerRepo.save(customer);
  }

  async unblock(tenantId: string, id: string): Promise<Customer> {
    const customer = await this.findById(tenantId, id);
    customer.isBlocked = false;
    customer.blockReason = null;
    return this.customerRepo.save(customer);
  }

  async findAddresses(tenantId: string, customerId: string): Promise<CustomerAddress[]> {
    await this.findById(tenantId, customerId);
    return this.addresses.find({
      where: { tenantId, customerId },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  /** The first address of a customer becomes its default. */
  async addAddress(
    tenantId: string,
    customerId: string,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    await this.findById(tenantId, customerId);
    const count = await this.addresses.count({ where: { tenantId, customerId } });
    const isDefault = dto.isDefault ?? count === 0;
    if (isDefault) await this.clearDefault(tenantId, customerId);
    return this.addresses.save(
      this.addresses.create({
        tenantId,
        customerId,
        label: dto.label,
        address: dto.address,
        city: dto.city ?? null,
        deliveryZone: dto.deliveryZone ?? null,
        phone: dto.phone ?? null,
        isDefault,
      }),
    );
  }

  async updateAddress(
    tenantId: string,
    customerId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddress> {
    const address = await this.getAddress(tenantId, customerId, addressId);
    if (dto.isDefault && !address.isDefault) await this.clearDefault(tenantId, customerId);
    Object.assign(address, dto);
    return this.addresses.save(address);
  }

  /** Removing the default address promotes the oldest remaining one. */
  async removeAddress(tenantId: string, customerId: string, addressId: string): Promise<void> {
    const address = await this.getAddress(tenantId, customerId, addressId);
    await this.addresses.delete({ id: address.id, tenantId });
    if (address.isDefault) {
      const next = await this.addresses.findOne({
        where: { tenantId, customerId },
        order: { createdAt: 'ASC' },
      });
      if (next) {
        next.isDefault = true;
        await this.addresses.save(next);
      }
    }
  }

  private get addresses(): Repository<CustomerAddress> {
    if (!this.addressRepo) throw new Error('Customer addresses are not available');
    return this.addressRepo;
  }

  private async getAddress(tenantId: string, customerId: string, id: string) {
    const address = await this.addresses.findOne({ where: { id, tenantId, customerId } });
    if (!address) throw new NotFoundException('Customer address not found');
    return address;
  }

  private async clearDefault(tenantId: string, customerId: string) {
    await this.addresses.update({ tenantId, customerId, isDefault: true }, { isDefault: false });
  }
}
