import { Entity, Column } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

@Entity('pos_terminals')
export class PosTerminal extends TenantBaseEntity {
  @Column({ name: 'branch_id', type: 'uuid' })
  branchId: string;

  @Column()
  name: string;

  @Column({ name: 'printer_ip', nullable: true })
  printerIp: string;

  @Column({ name: 'cash_drawer_port', nullable: true })
  cashDrawerPort: string;

  @Column({ name: 'scale_port', nullable: true })
  scalePort: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;
}
