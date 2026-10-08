import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';
import { Warehouse } from './warehouse.entity';
import { Product } from './product.entity';

export enum StockTransferStatus {
  DRAFT = 'draft',
  IN_TRANSIT = 'in_transit',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export interface TransferLotQty {
  lotNumber: string;
  quantity: number;
  expiryDate?: string | null;
}

/** Inter-warehouse transfer document (تحويل مخزني). */
@Entity('stock_transfers')
export class StockTransfer extends TenantBaseEntity {
  @Column({ name: 'transfer_number' })
  transferNumber: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'from_warehouse_id', type: 'uuid' })
  fromWarehouseId: string;

  @Column({ name: 'to_warehouse_id', type: 'uuid' })
  toWarehouseId: string;

  @Column({ type: 'enum', enum: StockTransferStatus, default: StockTransferStatus.DRAFT })
  status: StockTransferStatus;

  @Column({ type: 'varchar', nullable: true })
  notes: string | null;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt: Date | null;

  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'from_warehouse_id' })
  fromWarehouse: Warehouse;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'to_warehouse_id' })
  toWarehouse: Warehouse;

  @OneToMany(() => StockTransferLine, (line) => line.transfer, { cascade: true })
  lines: StockTransferLine[];
}

@Entity('stock_transfer_lines')
export class StockTransferLine extends TenantBaseEntity {
  @Column({ name: 'transfer_id', type: 'uuid' })
  transferId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  quantity: number;

  @Column({ name: 'qty_shipped', type: 'decimal', precision: 18, scale: 4, default: 0 })
  qtyShipped: number;

  @Column({ name: 'qty_received', type: 'decimal', precision: 18, scale: 4, default: 0 })
  qtyReceived: number;

  /** Average cost when shipped; the goods are received at this cost. */
  @Column({ name: 'unit_cost', type: 'decimal', precision: 18, scale: 4, default: 0 })
  unitCost: number;

  /** Lots requested on the draft (optional; FEFO otherwise). */
  @Column({ name: 'requested_lots', type: 'jsonb', nullable: true })
  requestedLots: TransferLotQty[] | null;

  @Column({ name: 'shipped_lots', type: 'jsonb', default: () => "'[]'" })
  shippedLots: TransferLotQty[];

  @Column({ name: 'received_lots', type: 'jsonb', default: () => "'[]'" })
  receivedLots: TransferLotQty[];

  @ManyToOne(() => StockTransfer, (transfer) => transfer.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transfer_id' })
  transfer: StockTransfer;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
