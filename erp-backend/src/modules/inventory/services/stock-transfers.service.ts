import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  StockTransfer,
  StockTransferLine,
  StockTransferStatus,
  TransferLotQty,
} from '../entities/stock-transfer.entity';
import { StockMovementType } from '../entities/stock-movement.entity';
import { Product, ProductType } from '../entities/product.entity';
import { Warehouse } from '../entities/warehouse.entity';
import { CreateStockTransferDto, ReceiveStockTransferDto } from '../dto/stock-transfer-document.dto';
import { StockService } from './stock.service';
import { ProductsService } from './products.service';
import { LotAllocation, StockLotInput, fefoSort } from './lots.service';
import { SequenceService } from '@shared/services/sequence.service';
import { AutoPostingService } from '@modules/accounting/services/auto-posting.service';
import { JournalType } from '@modules/accounting/entities/journal.entity';
import { round, today } from '@shared/utils/document-totals.util';

const EPS = 0.00005;

/**
 * Inter-warehouse transfer documents (تحويل مخزني, Odoo internal transfer).
 *
 * draft -> ship (stock leaves the source, goods in transit) -> receive
 * (full or partial, into the destination) -> done; or `validate` for a
 * one-step transfer. Goods move at the average cost of the shipment, so there
 * is no P&L impact. When the warehouses belong to different branches, each
 * receipt posts Dr inventory (destination branch) / Cr inventory (source
 * branch) so branch balance sheets follow the goods.
 */
@Injectable()
export class StockTransfersService {
  constructor(
    @InjectRepository(StockTransfer)
    private readonly transferRepo: Repository<StockTransfer>,
    @InjectRepository(StockTransferLine)
    private readonly lineRepo: Repository<StockTransferLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Warehouse)
    private readonly warehouseRepo: Repository<Warehouse>,
    private readonly stockService: StockService,
    private readonly productsService: ProductsService,
    private readonly sequenceService: SequenceService,
    private readonly autoPosting: AutoPostingService,
  ) {}

  async create(tenantId: string, userId: string, dto: CreateStockTransferDto): Promise<StockTransfer> {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }
    await this.getWarehouse(tenantId, dto.fromWarehouseId, 'Source');
    await this.getWarehouse(tenantId, dto.toWarehouseId, 'Destination');

    const lines: Partial<StockTransferLine>[] = [];
    for (const l of dto.lines) {
      const product = await this.productRepo.findOne({ where: { id: l.productId, tenantId } });
      if (!product) throw new NotFoundException('Product not found');
      if (product.type === ProductType.SERVICE) {
        throw new BadRequestException(`Service ${product.code} cannot be transferred`);
      }
      const quantity = await this.productsService.toBaseQuantity(tenantId, l.productId, l.quantity, l.unitId);
      if (!(quantity > 0)) throw new BadRequestException('Transfer quantity must be positive');
      lines.push({
        tenantId,
        productId: l.productId,
        quantity,
        qtyShipped: 0,
        qtyReceived: 0,
        unitCost: 0,
        requestedLots: l.lots?.length
          ? l.lots.map((x) => ({ lotNumber: x.lotNumber, quantity: Number(x.quantity), expiryDate: x.expiryDate ?? null }))
          : null,
        shippedLots: [],
        receivedLots: [],
      });
    }

    const transfer = await this.transferRepo.save(
      this.transferRepo.create({
        tenantId,
        transferNumber: await this.sequenceService.next(tenantId, 'stock_transfer', 'TRF'),
        date: dto.date || today(),
        fromWarehouseId: dto.fromWarehouseId,
        toWarehouseId: dto.toWarehouseId,
        notes: dto.notes ?? null,
        status: StockTransferStatus.DRAFT,
        createdBy: userId,
        lines: lines as StockTransferLine[],
      }),
    );

    if (dto.direct) return this.validate(tenantId, userId, transfer.id);
    return this.findById(tenantId, transfer.id);
  }

  findAll(tenantId: string, filter: { status?: StockTransferStatus; warehouseId?: string } = {}) {
    const qb = this.transferRepo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.lines', 'l')
      .leftJoinAndSelect('t.fromWarehouse', 'fw')
      .leftJoinAndSelect('t.toWarehouse', 'tw')
      .where('t.tenantId = :tenantId', { tenantId })
      .orderBy('t.createdAt', 'DESC');
    if (filter.status) qb.andWhere('t.status = :status', { status: filter.status });
    if (filter.warehouseId) {
      qb.andWhere('(t.fromWarehouseId = :wh OR t.toWarehouseId = :wh)', { wh: filter.warehouseId });
    }
    return qb.getMany().then((rows) => rows.map((t) => this.withTotals(t)));
  }

  async findById(tenantId: string, id: string) {
    const transfer = await this.load(tenantId, id);
    return this.withTotals(transfer);
  }

  /** Ships the draft: stock leaves the source warehouse and is in transit. */
  async ship(tenantId: string, userId: string, id: string) {
    const transfer = await this.load(tenantId, id);
    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new ConflictException('Only draft transfers can be shipped');
    }
    const destination = transfer.toWarehouse?.nameEn || transfer.toWarehouse?.nameAr || '';
    for (const line of transfer.lines) {
      const issued = await this.stockService.issue(
        tenantId,
        userId,
        {
          productId: line.productId,
          warehouseId: transfer.fromWarehouseId,
          quantity: Number(line.quantity),
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          description: `Transfer ${transfer.transferNumber} to ${destination}`.trim(),
          lots: line.requestedLots ?? undefined,
        },
        // Expired lots move only when named explicitly (e.g. to a quarantine warehouse)
        { movementType: StockMovementType.TRANSFER },
      );
      line.unitCost = issued.unitCost;
      line.qtyShipped = Number(line.quantity);
      line.shippedLots = issued.lots;
      line.receivedLots = [];
    }
    await this.lineRepo.save(transfer.lines);
    transfer.status = StockTransferStatus.IN_TRANSIT;
    transfer.shippedAt = new Date();
    await this.transferRepo.save(this.stripLines(transfer));
    return this.findById(tenantId, id);
  }

  /** Receives shipped goods (all outstanding, or the given partial quantities). */
  async receive(tenantId: string, userId: string, id: string, dto: ReceiveStockTransferDto = {}) {
    const transfer = await this.load(tenantId, id);
    if (transfer.status !== StockTransferStatus.IN_TRANSIT) {
      throw new ConflictException('Only transfers in transit can be received');
    }
    const date = dto.date || today();
    const requested = dto.lines ? new Map(dto.lines.map((l) => [l.lineId, l])) : null;
    if (requested) {
      for (const lineId of requested.keys()) {
        if (!transfer.lines.some((l) => l.id === lineId)) {
          throw new BadRequestException(`Line ${lineId} does not belong to this transfer`);
        }
      }
    }

    const crossBranch = transfer.fromWarehouse?.branchId !== transfer.toWarehouse?.branchId;
    if (crossBranch) await this.autoPosting.preflight(tenantId, date, ['inventoryAccountId']);

    const origin = transfer.fromWarehouse?.nameEn || transfer.fromWarehouse?.nameAr || '';
    let value = 0;
    let received = 0;
    for (const line of transfer.lines) {
      const outstanding = round(Number(line.qtyShipped) - Number(line.qtyReceived), 4);
      const req = requested?.get(line.id);
      const quantity = requested ? Number(req?.quantity ?? 0) : outstanding;
      if (quantity <= 0) continue;
      if (quantity > outstanding + EPS) {
        throw new BadRequestException('Received quantity exceeds the quantity in transit');
      }
      const allocations = this.allocateReceivedLots(line, quantity, req?.lots);
      await this.stockService.receive(
        tenantId,
        userId,
        {
          productId: line.productId,
          warehouseId: transfer.toWarehouseId,
          quantity,
          unitCost: Number(line.unitCost),
          referenceType: 'stock_transfer',
          referenceId: transfer.id,
          description: `Transfer ${transfer.transferNumber} from ${origin}`.trim(),
        },
        { movementType: StockMovementType.TRANSFER, lotAllocations: allocations },
      );
      line.qtyReceived = round(Number(line.qtyReceived) + quantity, 4);
      line.receivedLots = this.mergeLots(line.receivedLots ?? [], allocations);
      value += quantity * Number(line.unitCost);
      received += quantity;
    }
    if (received === 0) throw new BadRequestException('Nothing to receive');
    await this.lineRepo.save(transfer.lines);

    value = round(value, 4);
    if (crossBranch && value > 0) {
      await this.autoPosting.post({
        tenantId,
        userId,
        journalType: JournalType.GENERAL,
        date,
        description: `Inter-branch transfer ${transfer.transferNumber}`,
        sourceType: 'stock_transfer',
        sourceId: transfer.id,
        buildLines: (_s, account) => [
          { accountId: account('inventoryAccountId'), debit: value, branchId: transfer.toWarehouse?.branchId },
          { accountId: account('inventoryAccountId'), credit: value, branchId: transfer.fromWarehouse?.branchId },
        ],
      });
    }

    const complete = transfer.lines.every((l) => Number(l.qtyReceived) + EPS >= Number(l.qtyShipped));
    if (complete) {
      transfer.status = StockTransferStatus.DONE;
      transfer.receivedAt = new Date();
      await this.transferRepo.save(this.stripLines(transfer));
    }
    return this.findById(tenantId, id);
  }

  /** One-step transfer: ships (if draft) and receives everything outstanding. */
  async validate(tenantId: string, userId: string, id: string) {
    const transfer = await this.load(tenantId, id);
    if (transfer.status === StockTransferStatus.DRAFT) await this.ship(tenantId, userId, id);
    else if (transfer.status !== StockTransferStatus.IN_TRANSIT) {
      throw new ConflictException('Only draft or in-transit transfers can be validated');
    }
    return this.receive(tenantId, userId, id, {});
  }

  /**
   * Cancels a draft, or a shipped transfer nothing of which was received yet
   * (the goods go back to the source warehouse with their lots).
   */
  async cancel(tenantId: string, userId: string, id: string) {
    const transfer = await this.load(tenantId, id);
    if (transfer.status === StockTransferStatus.IN_TRANSIT) {
      if (transfer.lines.some((l) => Number(l.qtyReceived) > 0)) {
        throw new ConflictException('A partially received transfer cannot be cancelled');
      }
      for (const line of transfer.lines) {
        if (!(Number(line.qtyShipped) > 0)) continue;
        await this.stockService.receive(
          tenantId,
          userId,
          {
            productId: line.productId,
            warehouseId: transfer.fromWarehouseId,
            quantity: Number(line.qtyShipped),
            unitCost: Number(line.unitCost),
            referenceType: 'stock_transfer',
            referenceId: transfer.id,
            description: `Transfer ${transfer.transferNumber} cancelled`,
          },
          {
            movementType: StockMovementType.TRANSFER,
            lotAllocations: (line.shippedLots ?? []).map((l) => ({
              lotNumber: l.lotNumber,
              quantity: Number(l.quantity),
              expiryDate: l.expiryDate ?? null,
            })),
          },
        );
        line.qtyShipped = 0;
        line.shippedLots = [];
      }
      await this.lineRepo.save(transfer.lines);
    } else if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new ConflictException('Only draft or in-transit transfers can be cancelled');
    }
    transfer.status = StockTransferStatus.CANCELLED;
    await this.transferRepo.save(this.stripLines(transfer));
    return this.findById(tenantId, id);
  }

  /**
   * Picks the lots of a (partial) receipt among the shipped lots not yet
   * received: the given ones, or FEFO. Any rest is the untracked part.
   */
  allocateReceivedLots(line: StockTransferLine, quantity: number, lots?: StockLotInput[]): LotAllocation[] {
    const remaining = new Map<string, LotAllocation>();
    for (const s of line.shippedLots ?? []) {
      remaining.set(s.lotNumber, {
        lotNumber: s.lotNumber,
        quantity: Number(s.quantity),
        expiryDate: s.expiryDate ?? null,
      });
    }
    for (const r of line.receivedLots ?? []) {
      const lot = remaining.get(r.lotNumber);
      if (lot) lot.quantity = round(lot.quantity - Number(r.quantity), 4);
    }
    const open = [...remaining.values()].filter((l) => l.quantity > EPS);
    const openTotal = open.reduce((s, l) => s + l.quantity, 0);
    const untrackedOpen = round(
      Number(line.qtyShipped) - Number(line.qtyReceived) - openTotal,
      4,
    );

    if (lots?.length) {
      const result: LotAllocation[] = [];
      let total = 0;
      for (const l of lots) {
        const lot = remaining.get(l.lotNumber);
        if (!lot || lot.quantity + EPS < Number(l.quantity)) {
          throw new BadRequestException(`Lot ${l.lotNumber} was not shipped in that quantity`);
        }
        lot.quantity = round(lot.quantity - Number(l.quantity), 4);
        result.push({ lotNumber: l.lotNumber, quantity: Number(l.quantity), expiryDate: lot.expiryDate });
        total += Number(l.quantity);
      }
      if (total > quantity + EPS || quantity - total > Math.max(untrackedOpen, 0) + EPS) {
        throw new BadRequestException('Received lot quantities do not match the received quantity');
      }
      return result;
    }

    const result: LotAllocation[] = [];
    let rest = quantity;
    for (const lot of fefoSort(open)) {
      if (rest <= EPS) break;
      const qty = round(Math.min(lot.quantity, rest), 4);
      result.push({ lotNumber: lot.lotNumber, quantity: qty, expiryDate: lot.expiryDate });
      rest = round(rest - qty, 4);
    }
    return result;
  }

  private mergeLots(current: TransferLotQty[], added: LotAllocation[]): TransferLotQty[] {
    const map = new Map<string, TransferLotQty>(current.map((l) => [l.lotNumber, { ...l }]));
    for (const a of added) {
      const existing = map.get(a.lotNumber);
      if (existing) existing.quantity = round(Number(existing.quantity) + a.quantity, 4);
      else map.set(a.lotNumber, { lotNumber: a.lotNumber, quantity: a.quantity, expiryDate: a.expiryDate });
    }
    return [...map.values()];
  }

  private withTotals(t: StockTransfer) {
    const lines = t.lines ?? [];
    const inTransitQty = round(
      lines.reduce((s, l) => s + Number(l.qtyShipped) - Number(l.qtyReceived), 0),
      4,
    );
    const inTransitValue = round(
      lines.reduce((s, l) => s + (Number(l.qtyShipped) - Number(l.qtyReceived)) * Number(l.unitCost), 0),
      4,
    );
    return Object.assign(t, { inTransitQty, inTransitValue });
  }

  private stripLines(t: StockTransfer): StockTransfer {
    // Lines are saved separately; avoid cascading stale relation objects.
    const { lines: _lines, fromWarehouse: _f, toWarehouse: _t, ...rest } = t as any;
    return rest as StockTransfer;
  }

  private async load(tenantId: string, id: string): Promise<StockTransfer> {
    const transfer = await this.transferRepo.findOne({
      where: { id, tenantId },
      relations: ['lines', 'lines.product', 'fromWarehouse', 'toWarehouse'],
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    transfer.lines.sort((a, b) => (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0));
    return transfer;
  }

  private async getWarehouse(tenantId: string, id: string, label: string): Promise<Warehouse> {
    const warehouse = await this.warehouseRepo.findOne({ where: { id, tenantId } });
    if (!warehouse) throw new NotFoundException(`${label} warehouse not found`);
    return warehouse;
  }
}
