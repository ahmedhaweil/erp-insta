import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

/** ETA receiver type: B business, P natural person, F foreigner. */
export enum ReceiverType {
  BUSINESS = 'B',
  PERSON = 'P',
  FOREIGNER = 'F',
}

/**
 * Tax-authority profile of a customer (receiver / buyer): identifiers and the
 * structured address that ETA and ZATCA require but the customer master does
 * not hold. When absent, the profile is inferred from the customer record.
 */
@Entity('compliance_parties')
@Index(['tenantId', 'customerId'], { unique: true })
export class ComplianceParty extends TenantBaseEntity {
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'receiver_type', type: 'enum', enum: ReceiverType, default: ReceiverType.BUSINESS })
  receiverType: ReceiverType;

  /** Tax registration no. (B / ZATCA VAT), national id (P) or passport (F). */
  @Column({ nullable: true })
  identifier: string;

  @Column({ name: 'country_code', default: 'EG' })
  countryCode: string;

  @Column({ nullable: true })
  governate: string;

  @Column({ name: 'region_city', nullable: true })
  regionCity: string;

  @Column({ nullable: true })
  street: string;

  @Column({ name: 'building_number', nullable: true })
  buildingNumber: string;

  @Column({ name: 'postal_code', nullable: true })
  postalCode: string;

  @Column({ nullable: true })
  district: string;

  /** ZATCA buyer additional id scheme (CRN, NAT, IQA, PAS, ...) and value. */
  @Column({ name: 'other_id_scheme', nullable: true })
  otherIdScheme: string;

  @Column({ name: 'other_id', nullable: true })
  otherId: string;
}
