import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Bom } from '../entities/bom.entity';
import { BomLine, BomLineType } from '../entities/bom-line.entity';
import { ProductionOrder } from '../entities/production-order.entity';
import { CreateBomDto, UpdateBomDto } from '../dto/bom.dto';
import { Product, ProductType } from '@modules/inventory/entities/product.entity';
import { StockService } from '@modules/inventory/services/stock.service';
import { SequenceService } from '@shared/services/sequence.service';
import { round } from '@shared/utils/document-totals.util';

const MAX_BOM_DEPTH = 20;

export interface ExplodedRequirement {
  productId: string;
  /** Required quantity, scrap allowance included. */
  quantity: number;
  /** Depth in the BOM tree (1 = direct component of the top BOM). */
  level: number;
}

export interface ExplosionNode {
  productId: string;
  quantity: number;
  scrapPercent: number;
  level: number;
  bomId?: string;
  children?: ExplosionNode[];
}

export interface Explosion {
  bomId: string;
  productId: string;
  quantity: number;
  /** Leaf components (purchased / without own BOM), aggregated per product. */
  components: ExplodedRequirement[];
  /** Sub-assemblies replaced by their components. */
  subAssemblies: ExplodedRequirement[];
  /** Direct by-products of the top BOM for this quantity. */
  byProducts: { productId: string; quantity: number; costSharePercent: number }[];
  /** Labour and overhead of the top BOM and every exploded sub-assembly. */
  labourCost: number;
  overheadCost: number;
  tree: ExplosionNode[];
}

export interface CostRollupLine {
  productId: string;
  productCode?: string;
  productName?: string;
  quantity: number;
  unitCost: number;
  cost: number;
  costSource: 'average_cost' | 'sub_bom';
  subBomId?: string;
}

/**
 * Bills of materials with versions (one active per product) and multi-level
 * explosion / cost roll-up (Odoo mrp.bom, BoM structure & cost report).
 */
@Injectable()
export class BomsService {
  constructor(
    @InjectRepository(Bom)
    private readonly bomRepo: Repository<Bom>,
    @InjectRepository(BomLine)
    private readonly lineRepo: Repository<BomLine>,
    @InjectRepository(ProductionOrder)
    private readonly orderRepo: Repository<ProductionOrder>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly stockService: StockService,
    private readonly sequenceService: SequenceService,
  ) {}

  findAll(tenantId: string, productId?: string, activeOnly?: boolean): Promise<Bom[]> {
    const where: any = { tenantId };
    if (productId) where.productId = productId;
    if (activeOnly) where.isActive = true;
    return this.bomRepo.find({
      where,
      relations: ['lines', 'product'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<Bom> {
    const bom = await this.bomRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'lines.product', 'product'],
    });
    if (!bom) throw new NotFoundException('Bill of materials not found');
    bom.lines?.sort((a, b) => a.sequence - b.sequence);
    return bom;
  }

  getActiveBom(tenantId: string, productId: string): Promise<Bom | null> {
    return this.bomRepo.findOne({
      where: { tenantId, productId, isActive: true },
      relations: ['lines'],
      order: { version: 'DESC' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateBomDto): Promise<Bom> {
    const product = await this.productRepo.findOne({ where: { id: dto.productId, tenantId } });
    if (!product) throw new NotFoundException('Finished product not found');
    if (product.type === ProductType.SERVICE) {
      throw new BadRequestException('A service cannot be manufactured');
    }
    const lines = await this.buildLines(tenantId, dto.productId, dto);

    const latest = await this.bomRepo.findOne({
      where: { tenantId, productId: dto.productId },
      order: { version: 'DESC' },
    });
    const hasActive = await this.bomRepo.findOne({
      where: { tenantId, productId: dto.productId, isActive: true },
    });
    const isActive = dto.isActive ?? !hasActive;

    const code = await this.sequenceService.next(tenantId, 'mfg_bom', 'BOM');
    const bom = await this.bomRepo.save(
      this.bomRepo.create({
        tenantId,
        code,
        name: dto.name ?? product.nameEn ?? product.nameAr,
        productId: dto.productId,
        outputQuantity: dto.outputQuantity ?? 1,
        version: (latest?.version ?? 0) + 1,
        isActive: false,
        labourCostPerUnit: dto.labourCostPerUnit ?? 0,
        overheadCostPerUnit: dto.overheadCostPerUnit ?? 0,
        notes: dto.notes,
        createdBy: userId,
        lines: lines.map((l) => this.lineRepo.create({ ...l, tenantId })),
      }),
    );
    if (isActive) await this.activate(tenantId, bom.id);
    return this.findById(tenantId, bom.id);
  }

  async update(tenantId: string, id: string, dto: UpdateBomDto): Promise<Bom> {
    const bom = await this.findById(tenantId, id);
    if (dto.productId && dto.productId !== bom.productId) {
      throw new BadRequestException('The finished product of a BOM cannot be changed; create a new BOM');
    }
    if (dto.components || dto.byProducts) {
      const lines = await this.buildLines(tenantId, bom.productId, {
        components:
          dto.components ??
          bom.lines
            .filter((l) => l.type === BomLineType.COMPONENT)
            .map((l) => ({
              productId: l.productId,
              quantity: Number(l.quantity),
              scrapPercent: Number(l.scrapPercent),
            })),
        byProducts:
          dto.byProducts ??
          bom.lines
            .filter((l) => l.type === BomLineType.BY_PRODUCT)
            .map((l) => ({
              productId: l.productId,
              quantity: Number(l.quantity),
              costSharePercent: Number(l.costSharePercent),
            })),
      });
      await this.lineRepo.delete({ tenantId, bomId: bom.id });
      await this.lineRepo.save(lines.map((l) => this.lineRepo.create({ ...l, tenantId, bomId: bom.id })));
    }
    const patch: Partial<Bom> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.outputQuantity !== undefined) patch.outputQuantity = dto.outputQuantity;
    if (dto.labourCostPerUnit !== undefined) patch.labourCostPerUnit = dto.labourCostPerUnit;
    if (dto.overheadCostPerUnit !== undefined) patch.overheadCostPerUnit = dto.overheadCostPerUnit;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (Object.keys(patch).length) await this.bomRepo.update({ id: bom.id, tenantId }, patch);
    if (dto.isActive === true) await this.activate(tenantId, bom.id);
    if (dto.isActive === false) await this.bomRepo.update({ id: bom.id, tenantId }, { isActive: false });
    return this.findById(tenantId, bom.id);
  }

  /** Makes this version the active BOM of its product (deactivating the others). */
  async activate(tenantId: string, id: string): Promise<Bom> {
    const bom = await this.bomRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!bom) throw new NotFoundException('Bill of materials not found');
    // Activating must not create a cycle through other products' active BOMs.
    await this.assertNoCycle(tenantId, bom.productId, bom.lines ?? []);
    await this.bomRepo.update({ tenantId, productId: bom.productId, isActive: true }, { isActive: false });
    await this.bomRepo.update({ id, tenantId }, { isActive: true });
    return this.findById(tenantId, id);
  }

  async deactivate(tenantId: string, id: string): Promise<Bom> {
    await this.findById(tenantId, id);
    await this.bomRepo.update({ id, tenantId }, { isActive: false });
    return this.findById(tenantId, id);
  }

  /** Copies a BOM into a new (inactive unless requested) version. */
  async newVersion(tenantId: string, userId: string, id: string, activate = false): Promise<Bom> {
    const bom = await this.findById(tenantId, id);
    const components = bom.lines.filter((l) => l.type === BomLineType.COMPONENT);
    const byProducts = bom.lines.filter((l) => l.type === BomLineType.BY_PRODUCT);
    return this.create(tenantId, userId, {
      productId: bom.productId,
      name: bom.name,
      outputQuantity: Number(bom.outputQuantity),
      labourCostPerUnit: Number(bom.labourCostPerUnit),
      overheadCostPerUnit: Number(bom.overheadCostPerUnit),
      notes: bom.notes,
      isActive: activate,
      components: components.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        scrapPercent: Number(l.scrapPercent),
      })),
      byProducts: byProducts.map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        costSharePercent: Number(l.costSharePercent),
      })),
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findById(tenantId, id);
    const used = await this.orderRepo.count({ where: { tenantId, bomId: id } });
    if (used > 0) {
      throw new ConflictException('BOM is used by production orders; deactivate it instead');
    }
    await this.lineRepo.delete({ tenantId, bomId: id });
    await this.bomRepo.delete({ id, tenantId });
  }

  /**
   * Requirements for `quantity` finished units. With `explode`, components
   * that have their own active BOM are replaced, recursively, by their
   * components (multi-level BOM), adding their labour and overhead.
   */
  async explode(
    tenantId: string,
    bom: Bom,
    quantity: number,
    explode = true,
  ): Promise<Explosion> {
    const leaves = new Map<string, ExplodedRequirement>();
    const subs = new Map<string, ExplodedRequirement>();
    const totals = { labour: 0, overhead: 0 };

    const walk = async (
      current: Bom,
      qty: number,
      level: number,
      path: string[],
    ): Promise<ExplosionNode[]> => {
      if (level > MAX_BOM_DEPTH) throw new BadRequestException('BOM structure is too deep');
      totals.labour += qty * Number(current.labourCostPerUnit || 0);
      totals.overhead += qty * Number(current.overheadCostPerUnit || 0);
      const factor = qty / Number(current.outputQuantity || 1);
      const nodes: ExplosionNode[] = [];
      for (const line of (current.lines ?? []).filter((l) => l.type === BomLineType.COMPONENT)) {
        const required = round(
          Number(line.quantity) * factor * (1 + Number(line.scrapPercent || 0) / 100),
          4,
        );
        const node: ExplosionNode = {
          productId: line.productId,
          quantity: required,
          scrapPercent: Number(line.scrapPercent || 0),
          level,
        };
        const sub = explode ? await this.getActiveBom(tenantId, line.productId) : null;
        if (sub) {
          if (path.includes(line.productId)) {
            throw new BadRequestException('Circular BOM structure detected');
          }
          node.bomId = sub.id;
          node.children = await walk(sub, required, level + 1, [...path, line.productId]);
          this.accumulate(subs, line.productId, required, level);
        } else {
          this.accumulate(leaves, line.productId, required, level);
        }
        nodes.push(node);
      }
      return nodes;
    };

    const tree = await walk(bom, quantity, 1, [bom.productId]);
    const factor = quantity / Number(bom.outputQuantity || 1);
    return {
      bomId: bom.id,
      productId: bom.productId,
      quantity,
      components: [...leaves.values()],
      subAssemblies: [...subs.values()],
      byProducts: (bom.lines ?? [])
        .filter((l) => l.type === BomLineType.BY_PRODUCT)
        .map((l) => ({
          productId: l.productId,
          quantity: round(Number(l.quantity) * factor, 4),
          costSharePercent: Number(l.costSharePercent || 0),
        })),
      labourCost: round(totals.labour, 4),
      overheadCost: round(totals.overhead, 4),
      tree,
    };
  }

  async explodeById(tenantId: string, id: string, quantity?: number, explode = true) {
    const bom = await this.findById(tenantId, id);
    return this.explode(tenantId, bom, quantity ?? Number(bom.outputQuantity), explode);
  }

  /**
   * Cost roll-up at current costs: components at their average cost, or, for
   * sub-assemblies with an active BOM, at their own rolled-up cost.
   */
  async costRollup(tenantId: string, id: string, quantity?: number) {
    const bom = await this.findById(tenantId, id);
    const qty = quantity ?? Number(bom.outputQuantity);
    const result = await this.rollup(tenantId, bom, qty, [bom.productId]);
    const products = await this.productMap(tenantId, result.lines.map((l) => l.productId));
    for (const line of result.lines) {
      const p = products.get(line.productId);
      line.productCode = p?.code;
      line.productName = p?.nameEn || p?.nameAr;
    }
    return {
      bomId: bom.id,
      bomCode: bom.code,
      productId: bom.productId,
      version: bom.version,
      quantity: qty,
      currentAverageCost: await this.stockService.getUnitCost(tenantId, bom.productId),
      ...result,
    };
  }

  private async rollup(tenantId: string, bom: Bom, qty: number, path: string[]) {
    if (path.length > MAX_BOM_DEPTH) throw new BadRequestException('BOM structure is too deep');
    const factor = qty / Number(bom.outputQuantity || 1);
    const lines: CostRollupLine[] = [];
    for (const line of (bom.lines ?? []).filter((l) => l.type === BomLineType.COMPONENT)) {
      const quantity = round(
        Number(line.quantity) * factor * (1 + Number(line.scrapPercent || 0) / 100),
        4,
      );
      const sub = await this.getActiveBom(tenantId, line.productId);
      let unitCost: number;
      let costSource: CostRollupLine['costSource'] = 'average_cost';
      if (sub && !path.includes(line.productId)) {
        const subResult = await this.rollup(tenantId, sub, Number(sub.outputQuantity), [
          ...path,
          line.productId,
        ]);
        unitCost = subResult.unitCost;
        costSource = 'sub_bom';
      } else if (sub) {
        throw new BadRequestException('Circular BOM structure detected');
      } else {
        unitCost = await this.stockService.getUnitCost(tenantId, line.productId);
      }
      lines.push({
        productId: line.productId,
        quantity,
        unitCost: round(unitCost, 4),
        cost: round(quantity * unitCost, 4),
        costSource,
        subBomId: costSource === 'sub_bom' ? sub!.id : undefined,
      });
    }
    const materialCost = round(lines.reduce((s, l) => s + l.cost, 0), 4);
    const labourCost = round(qty * Number(bom.labourCostPerUnit || 0), 4);
    const overheadCost = round(qty * Number(bom.overheadCostPerUnit || 0), 4);
    const totalCost = round(materialCost + labourCost + overheadCost, 4);
    const byProductShare = (bom.lines ?? [])
      .filter((l) => l.type === BomLineType.BY_PRODUCT)
      .reduce((s, l) => s + Number(l.costSharePercent || 0), 0);
    const byProductCost = round((totalCost * byProductShare) / 100, 4);
    const unitCost = qty > 0 ? round((totalCost - byProductCost) / qty, 4) : 0;
    return { lines, materialCost, labourCost, overheadCost, byProductCost, totalCost, unitCost };
  }

  private accumulate(
    map: Map<string, ExplodedRequirement>,
    productId: string,
    quantity: number,
    level: number,
  ) {
    const existing = map.get(productId);
    if (existing) {
      existing.quantity = round(existing.quantity + quantity, 4);
      existing.level = Math.min(existing.level, level);
    } else {
      map.set(productId, { productId, quantity, level });
    }
  }

  async productMap(tenantId: string, ids: string[]): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const products = await this.productRepo.find({ where: { tenantId, id: In(unique) } });
    return new Map(products.map((p) => [p.id, p]));
  }

  private async buildLines(
    tenantId: string,
    finishedProductId: string,
    dto: Pick<CreateBomDto, 'components' | 'byProducts'>,
  ): Promise<Partial<BomLine>[]> {
    const components = dto.components ?? [];
    const byProducts = dto.byProducts ?? [];
    if (!components.length) throw new BadRequestException('A BOM needs at least one component');
    const ids = [...components, ...byProducts].map((l) => l.productId);
    if (ids.includes(finishedProductId)) {
      throw new BadRequestException('The finished product cannot be its own component or by-product');
    }
    const products = await this.productMap(tenantId, ids);
    const missing = ids.filter((pid) => !products.has(pid));
    if (missing.length) throw new NotFoundException(`Products not found: ${missing.join(', ')}`);
    for (const b of byProducts) {
      if (products.get(b.productId)!.type === ProductType.SERVICE) {
        throw new BadRequestException('A by-product must be a stockable product');
      }
    }
    const share = byProducts.reduce((s, b) => s + Number(b.costSharePercent || 0), 0);
    if (share >= 100) {
      throw new BadRequestException('By-product cost shares must total less than 100%');
    }

    const lines: Partial<BomLine>[] = [
      ...components.map((c, i) => ({
        type: BomLineType.COMPONENT,
        productId: c.productId,
        quantity: c.quantity,
        scrapPercent: c.scrapPercent ?? 0,
        costSharePercent: 0,
        sequence: i + 1,
      })),
      ...byProducts.map((b, i) => ({
        type: BomLineType.BY_PRODUCT,
        productId: b.productId,
        quantity: b.quantity,
        scrapPercent: 0,
        costSharePercent: b.costSharePercent ?? 0,
        sequence: components.length + i + 1,
      })),
    ];
    await this.assertNoCycle(tenantId, finishedProductId, lines);
    return lines;
  }

  /** Rejects component lists that reach the finished product through active sub-BOMs. */
  private async assertNoCycle(
    tenantId: string,
    finishedProductId: string,
    lines: Partial<BomLine>[],
  ): Promise<void> {
    const visit = async (productId: string, depth: number): Promise<void> => {
      if (productId === finishedProductId) {
        throw new BadRequestException('Circular BOM structure detected');
      }
      if (depth > MAX_BOM_DEPTH) throw new BadRequestException('BOM structure is too deep');
      const sub = await this.getActiveBom(tenantId, productId);
      for (const l of (sub?.lines ?? []).filter((x) => x.type === BomLineType.COMPONENT)) {
        await visit(l.productId, depth + 1);
      }
    };
    for (const l of lines.filter((x) => x.type !== BomLineType.BY_PRODUCT)) {
      await visit(l.productId!, 1);
    }
  }
}
