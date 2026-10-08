import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PurchaseRequisition,
  PurchaseRequisitionLine,
  PurchaseRequisitionStatus,
} from '../entities/purchase-requisition.entity';
import { PurchaseOrder } from '../entities/purchase-order.entity';
import {
  ConvertRequisitionDto,
  CreatePurchaseRequisitionDto,
} from '../dto/purchase-requisition.dto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchasingSettingsService } from './purchasing-settings.service';
import { Product } from '@modules/inventory/entities/product.entity';
import { SequenceService } from '@shared/services/sequence.service';
import { today } from '@shared/utils/document-totals.util';

/**
 * Purchase requisitions: departments request goods, a purchasing approver
 * approves them and they are converted into one RFQ per vendor.
 */
@Injectable()
export class PurchaseRequisitionsService {
  constructor(
    @InjectRepository(PurchaseRequisition)
    private readonly requisitionRepo: Repository<PurchaseRequisition>,
    @InjectRepository(PurchaseRequisitionLine)
    private readonly lineRepo: Repository<PurchaseRequisitionLine>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly ordersService: PurchaseOrdersService,
    private readonly settingsService: PurchasingSettingsService,
    private readonly sequenceService: SequenceService,
  ) {}

  async create(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseRequisitionDto,
  ): Promise<PurchaseRequisition> {
    const productIds = [...new Set(dto.lines.map((l) => l.productId))];
    const found = await this.productRepo.count({ where: { tenantId, id: In(productIds) } });
    if (found !== productIds.length) throw new NotFoundException('Product not found');

    const { lines, ...header } = dto;
    return this.requisitionRepo.save(
      this.requisitionRepo.create({
        ...header,
        tenantId,
        requisitionNumber: await this.sequenceService.next(tenantId, 'purchase_requisition', 'PR'),
        requestedBy: userId,
        date: dto.date || today(),
        status: PurchaseRequisitionStatus.DRAFT,
        purchaseOrderIds: [],
        lines: lines.map((l) => this.lineRepo.create(l)),
      }),
    );
  }

  findAll(tenantId: string, status?: PurchaseRequisitionStatus): Promise<PurchaseRequisition[]> {
    const where: Record<string, unknown> = { tenantId };
    if (status) where.status = status;
    return this.requisitionRepo.find({ where, relations: ['lines'], order: { createdAt: 'DESC' } });
  }

  async findById(tenantId: string, id: string): Promise<PurchaseRequisition> {
    const requisition = await this.requisitionRepo.findOne({
      where: { id, tenantId },
      relations: ['lines'],
    });
    if (!requisition) throw new NotFoundException('Purchase requisition not found');
    return requisition;
  }

  async submit(tenantId: string, id: string): Promise<PurchaseRequisition> {
    const requisition = await this.findById(tenantId, id);
    this.assertStatus(requisition, [PurchaseRequisitionStatus.DRAFT, PurchaseRequisitionStatus.REJECTED]);
    requisition.status = PurchaseRequisitionStatus.SUBMITTED;
    requisition.rejectionReason = null;
    return this.save(requisition);
  }

  async approve(tenantId: string, userId: string, id: string): Promise<PurchaseRequisition> {
    const requisition = await this.findById(tenantId, id);
    this.assertStatus(requisition, [PurchaseRequisitionStatus.SUBMITTED]);
    requisition.status = PurchaseRequisitionStatus.APPROVED;
    requisition.approvedBy = userId;
    requisition.approvedAt = new Date();
    return this.save(requisition);
  }

  async reject(tenantId: string, id: string, reason?: string): Promise<PurchaseRequisition> {
    const requisition = await this.findById(tenantId, id);
    this.assertStatus(requisition, [PurchaseRequisitionStatus.SUBMITTED]);
    requisition.status = PurchaseRequisitionStatus.REJECTED;
    requisition.rejectionReason = reason || 'Rejected';
    return this.save(requisition);
  }

  async cancel(tenantId: string, id: string): Promise<PurchaseRequisition> {
    const requisition = await this.findById(tenantId, id);
    this.assertStatus(requisition, [
      PurchaseRequisitionStatus.DRAFT,
      PurchaseRequisitionStatus.SUBMITTED,
      PurchaseRequisitionStatus.APPROVED,
      PurchaseRequisitionStatus.REJECTED,
    ]);
    requisition.status = PurchaseRequisitionStatus.CANCELLED;
    return this.save(requisition);
  }

  /**
   * Converts the requisition into draft RFQs grouped by vendor (explicit
   * vendor > line vendor > product preferred supplier), priced at the
   * estimated price or the product average cost.
   */
  async convert(
    tenantId: string,
    userId: string,
    id: string,
    dto: ConvertRequisitionDto = {},
  ): Promise<{ requisition: PurchaseRequisition; orders: PurchaseOrder[] }> {
    const requisition = await this.findById(tenantId, id);
    const settings = await this.settingsService.get(tenantId);
    const allowed = settings.requisitionApprovalRequired
      ? [PurchaseRequisitionStatus.APPROVED]
      : [
          PurchaseRequisitionStatus.DRAFT,
          PurchaseRequisitionStatus.SUBMITTED,
          PurchaseRequisitionStatus.APPROVED,
        ];
    if (!allowed.includes(requisition.status)) {
      throw new ConflictException(
        settings.requisitionApprovalRequired
          ? 'Only approved requisitions can be converted'
          : `Requisitions in status ${requisition.status} cannot be converted`,
      );
    }

    const products = await this.productRepo.find({
      where: { tenantId, id: In([...new Set(requisition.lines.map((l) => l.productId))]) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const groups = new Map<string, PurchaseRequisitionLine[]>();
    const missing: string[] = [];
    for (const line of requisition.lines) {
      const product = byId.get(line.productId);
      const supplierId = dto.supplierId || line.supplierId || product?.preferredSupplierId;
      if (!supplierId) {
        missing.push(product?.code ?? line.productId);
        continue;
      }
      groups.set(supplierId, [...(groups.get(supplierId) ?? []), line]);
    }
    if (missing.length) {
      throw new BadRequestException(
        `No vendor for: ${missing.join(', ')}; pass supplierId or set a preferred supplier`,
      );
    }

    const orders: PurchaseOrder[] = [];
    for (const [supplierId, lines] of groups) {
      const order = await this.ordersService.create(
        tenantId,
        userId,
        {
          supplierId,
          date: dto.date || today(),
          expectedDate: requisition.requiredDate ?? undefined,
          branchId: requisition.branchId ?? undefined,
          warehouseId: requisition.warehouseId ?? undefined,
          notes: `From requisition ${requisition.requisitionNumber}${requisition.departmentName ? ` (${requisition.departmentName})` : ''}`,
          lines: lines.map((l) => {
            const product = byId.get(l.productId);
            return {
              productId: l.productId,
              quantity: Number(l.quantity),
              unitPrice:
                l.estimatedPrice !== null && l.estimatedPrice !== undefined
                  ? Number(l.estimatedPrice)
                  : Number(product?.costPrice ?? 0),
              taxRate: Number(product?.purchaseTaxRate ?? 0),
              description: l.description,
            };
          }),
        },
        { requisitionId: requisition.id },
      );
      for (const l of lines) l.purchaseOrderId = order.id;
      orders.push(order);
    }
    await this.lineRepo.save(requisition.lines);

    requisition.status = PurchaseRequisitionStatus.CONVERTED;
    requisition.purchaseOrderIds = orders.map((o) => o.id);
    await this.save(requisition);
    return { requisition: await this.findById(tenantId, id), orders };
  }

  private assertStatus(requisition: PurchaseRequisition, allowed: PurchaseRequisitionStatus[]) {
    if (!allowed.includes(requisition.status)) {
      throw new ConflictException(
        `Requisition ${requisition.requisitionNumber} is ${requisition.status}`,
      );
    }
  }

  private async save(requisition: PurchaseRequisition): Promise<PurchaseRequisition> {
    const { lines, ...header } = requisition;
    await this.requisitionRepo.save(header as PurchaseRequisition);
    requisition.lines = lines;
    return requisition;
  }
}
