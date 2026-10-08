import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/**
 * Hash/counter chains that must be strictly sequential:
 *  - `zatca`                 : ICV counter + PIH (previous invoice hash)
 *  - `eta-receipt:<serial>`  : previousUUID of the last e-receipt of a POS device
 * Rows are locked FOR UPDATE inside the request transaction while used.
 */
@Entity('compliance_chains')
@Index(['tenantId', 'chainKey'], { unique: true })
export class ComplianceChain extends TenantBaseEntity {
  @Column({ name: 'chain_key' })
  chainKey: string;

  @Column({ type: 'int', default: 0 })
  counter: number;

  @Column({ name: 'last_hash', type: 'text', nullable: true })
  lastHash: string | null;
}
