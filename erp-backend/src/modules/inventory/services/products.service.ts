import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Product, TrackingType } from '../entities/product.entity';
import { ProductUnit } from '../entities/product-unit.entity';
import { Unit } from '../entities/unit.entity';
import { CreateProductDto, UpdateProductDto } from '../dto/create-product.dto';
import { ProductUnitDto } from '../dto/product-unit.dto';
import { round } from '@shared/utils/document-totals.util';

export interface BarcodeLookupResult {
  product: Product;
  /** Unit scanned: the product's base unit or an alternate unit. */
  unitId: string;
  unitName: string | null;
  /** Base units per scanned unit (1 for the base unit). */
  factor: number;
  /** Sell price of one scanned unit. */
  price: number;
  productUnitId: string | null;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductUnit)
    private readonly productUnitRepo: Repository<ProductUnit>,
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
  ) {}

  async create(tenantId: string, dto: CreateProductDto): Promise<Product> {
    this.assertTracking(dto);
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

  async update(tenantId: string, id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findById(tenantId, id);
    this.assertTracking({
      trackingType: dto.trackingType ?? product.trackingType,
      hasExpiry: dto.hasExpiry ?? product.hasExpiry,
    });
    Object.assign(product, dto);
    return this.productRepo.save(product);
  }

  // ---------------------------------------------------------------------------
  // Units of measure
  // ---------------------------------------------------------------------------

  async findUnits(tenantId: string, productId: string): Promise<ProductUnit[]> {
    await this.findById(tenantId, productId);
    return this.productUnitRepo.find({
      where: { tenantId, productId },
      relations: ['unit'],
      order: { factor: 'ASC' },
    });
  }

  /** Adds (or updates) an alternate unit of a product, e.g. carton = 12 pieces. */
  async upsertUnit(tenantId: string, productId: string, dto: ProductUnitDto): Promise<ProductUnit> {
    const product = await this.findById(tenantId, productId);
    if (dto.unitId === product.unitId) {
      throw new BadRequestException('The base unit cannot be added as an alternate unit');
    }
    if (!(Number(dto.factor) > 0)) throw new BadRequestException('Unit factor must be positive');
    const unit = await this.unitRepo.findOne({ where: { id: dto.unitId, tenantId } });
    if (!unit) throw new NotFoundException('Unit not found');

    let row = await this.productUnitRepo.findOne({ where: { tenantId, productId, unitId: dto.unitId } });
    if (dto.barcode) await this.assertBarcodeFree(tenantId, dto.barcode, { productUnitId: row?.id });
    if (!row) {
      row = this.productUnitRepo.create({ tenantId, productId, unitId: dto.unitId });
    }
    row.factor = Number(dto.factor);
    row.barcode = dto.barcode || null;
    row.sellPrice = dto.sellPrice ?? null;
    row.isActive = dto.isActive ?? true;
    return this.productUnitRepo.save(row);
  }

  async removeUnit(tenantId: string, productId: string, productUnitId: string): Promise<void> {
    const row = await this.productUnitRepo.findOne({ where: { id: productUnitId, tenantId, productId } });
    if (!row) throw new NotFoundException('Product unit not found');
    await this.productUnitRepo.remove(row);
  }

  /** Base units per one `unitId` of the product (1 for the base unit). */
  async unitFactor(tenantId: string, productId: string, unitId?: string | null): Promise<number> {
    const product = await this.productRepo.findOne({ where: { id: productId, tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!unitId || unitId === product.unitId) return 1;
    const row = await this.productUnitRepo.findOne({ where: { tenantId, productId, unitId } });
    if (row) return Number(row.factor);
    // Fall back to the global unit definition when both share the same base unit
    const unit = await this.unitRepo.findOne({ where: { id: unitId, tenantId } });
    if (unit?.baseUnitId && unit.baseUnitId === product.unitId) return Number(unit.conversionFactor);
    throw new BadRequestException(`Unit ${unitId} is not defined for product ${product.code}`);
  }

  /**
   * Converts a quantity expressed in `unitId` to the product's base (stock)
   * unit, e.g. 2 cartons of 12 -> 24. No unit or the base unit returns the
   * quantity unchanged.
   */
  async toBaseQuantity(tenantId: string, productId: string, quantity: number, unitId?: string | null): Promise<number> {
    const factor = await this.unitFactor(tenantId, productId, unitId);
    return round(Number(quantity) * factor, 4);
  }

  /**
   * POS/scanner lookup: searches product barcodes, then alternate unit
   * barcodes, then product codes/SKUs. Returns the product, the scanned unit,
   * its factor to the base unit and its sell price.
   */
  async lookupBarcode(tenantId: string, code: string): Promise<BarcodeLookupResult> {
    const value = String(code ?? '').trim();
    if (!value) throw new BadRequestException('Barcode is required');

    const product = await this.productRepo.findOne({
      where: { tenantId, barcode: value, isActive: true },
      relations: ['unit'],
    });
    if (product) return this.baseResult(product);

    const productUnit = await this.productUnitRepo.findOne({
      where: { tenantId, barcode: value, isActive: true },
      relations: ['product', 'product.unit', 'unit'],
    });
    if (productUnit?.product) {
      const factor = Number(productUnit.factor);
      return {
        product: productUnit.product,
        unitId: productUnit.unitId,
        unitName: productUnit.unit?.nameEn || productUnit.unit?.nameAr || null,
        factor,
        price:
          productUnit.sellPrice !== null && productUnit.sellPrice !== undefined
            ? Number(productUnit.sellPrice)
            : round(Number(productUnit.product.sellPrice || 0) * factor, 4),
        productUnitId: productUnit.id,
      };
    }

    const byCode =
      (await this.productRepo.findOne({ where: { tenantId, code: value, isActive: true }, relations: ['unit'] })) ??
      (await this.productRepo.findOne({ where: { tenantId, sku: value, isActive: true }, relations: ['unit'] }));
    if (byCode) return this.baseResult(byCode);

    throw new NotFoundException(`No product found for barcode ${value}`);
  }

  private baseResult(product: Product): BarcodeLookupResult {
    return {
      product,
      unitId: product.unitId,
      unitName: product.unit?.nameEn || product.unit?.nameAr || null,
      factor: 1,
      price: Number(product.sellPrice || 0),
      productUnitId: null,
    };
  }

  private async assertBarcodeFree(tenantId: string, barcode: string, self: { productUnitId?: string }) {
    const product = await this.productRepo.findOne({ where: { tenantId, barcode } });
    const unitWhere: any = { tenantId, barcode };
    if (self.productUnitId) unitWhere.id = Not(self.productUnitId);
    const unit = await this.productUnitRepo.findOne({ where: unitWhere });
    if (product || unit) throw new ConflictException(`Barcode ${barcode} is already used`);
  }

  private assertTracking(dto: { trackingType?: TrackingType; hasExpiry?: boolean }) {
    if (dto.hasExpiry && (!dto.trackingType || dto.trackingType === TrackingType.NONE)) {
      throw new BadRequestException('Expiry dates require lot or serial tracking');
    }
  }
}
