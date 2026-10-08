import { Entity, Column, Index } from 'typeorm';
import { TenantBaseEntity } from '@shared/entities/tenant-base.entity';

export enum ComplianceCountry {
  EG = 'EG',
  SA = 'SA',
}

export enum EtaEnvironment {
  PREPROD = 'preprod',
  PROD = 'prod',
}

export enum ZatcaEnvironment {
  SANDBOX = 'sandbox',
  SIMULATION = 'simulation',
  PRODUCTION = 'production',
}

/** A POS device registered with the ETA e-receipt system. */
export interface EtaPosDevice {
  /** POS terminal id (pos_terminals.id) this device is bound to. */
  terminalId?: string;
  serial: string;
  osVersion?: string;
  modelFramework?: string;
  /** Pre-shared key issued by ETA for the device (secret). */
  presharedKey?: string;
  /** e-receipt client credentials when they differ from the invoicing ones. */
  clientId?: string;
  clientSecret?: string;
}

/**
 * Per-tenant e-invoicing configuration for the Egyptian Tax Authority (ETA
 * e-invoice and e-receipt) and Saudi ZATCA (Fatoora). Secret fields are
 * stored encrypted when COMPLIANCE_SECRET_KEY is configured and are never
 * returned by the API.
 */
@Entity('compliance_settings')
@Index('UQ_compliance_settings_tenant', ['tenantId'], { unique: true })
export class ComplianceSettings extends TenantBaseEntity {
  @Column({ type: 'enum', enum: ComplianceCountry, default: ComplianceCountry.EG })
  country: ComplianceCountry;

  @Column({ name: 'is_enabled', default: false })
  isEnabled: boolean;

  /** Submit sales invoices automatically when they are posted. */
  @Column({ name: 'auto_submit', default: false })
  autoSubmit: boolean;

  // ---- Taxpayer / issuer -------------------------------------------------
  /** ETA registration number (RIN, 9 digits) or ZATCA VAT number (15 digits). */
  @Column({ name: 'taxpayer_id', nullable: true })
  taxpayerId: string;

  @Column({ name: 'taxpayer_name', nullable: true })
  taxpayerName: string;

  /** Seller commercial registration (ZATCA CRN). */
  @Column({ name: 'commercial_registration', nullable: true })
  commercialRegistration: string;

  /** ETA branch id ("0" for the head office). */
  @Column({ name: 'branch_code', default: '0' })
  branchCode: string;

  /** ETA taxpayer activity code (e.g. 4620). */
  @Column({ name: 'activity_code', nullable: true })
  activityCode: string;

  @Column({ name: 'address_country', default: 'EG' })
  addressCountry: string;

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

  /** ZATCA district (CitySubdivisionName). */
  @Column({ nullable: true })
  district: string;

  @Column({ nullable: true })
  floor: string;

  @Column({ nullable: true })
  room: string;

  @Column({ nullable: true })
  landmark: string;

  @Column({ name: 'additional_information', nullable: true })
  additionalInformation: string;

  // ---- ETA ---------------------------------------------------------------
  @Column({ name: 'eta_environment', type: 'enum', enum: EtaEnvironment, default: EtaEnvironment.PREPROD })
  etaEnvironment: EtaEnvironment;

  @Column({ name: 'eta_client_id', nullable: true })
  etaClientId: string;

  @Column({ name: 'eta_client_secret', type: 'text', nullable: true })
  etaClientSecret: string;

  /** Overrides ETA_SIGNER_URL for this tenant (USB-token signing middleware). */
  @Column({ name: 'eta_signer_url', nullable: true })
  etaSignerUrl: string;

  /** ETA document type version: "1.0" (signed) or "0.9" (unsigned, preprod only). */
  @Column({ name: 'eta_document_version', default: '1.0' })
  etaDocumentVersion: string;

  /** Default ETA unit type when a product has no explicit mapping. */
  @Column({ name: 'default_unit_type', default: 'EA' })
  defaultUnitType: string;

  /** Maps units.id -> ETA unit type code (e.g. KGM, LTR). */
  @Column({ name: 'unit_type_map', type: 'jsonb', default: {} })
  unitTypeMap: Record<string, string>;

  /** Default ETA tax subtype for VAT lines (V009 = general standard rate). */
  @Column({ name: 'default_tax_subtype', default: 'V009' })
  defaultTaxSubtype: string;

  /** POS devices registered for e-receipts (preshared keys are secret). */
  @Column({ name: 'pos_devices', type: 'jsonb', default: [] })
  posDevices: EtaPosDevice[];

  // ---- ZATCA -------------------------------------------------------------
  @Column({ name: 'zatca_environment', type: 'enum', enum: ZatcaEnvironment, default: ZatcaEnvironment.SANDBOX })
  zatcaEnvironment: ZatcaEnvironment;

  /** Production CSID certificate (PEM or base64 DER) issued by ZATCA. */
  @Column({ name: 'zatca_certificate', type: 'text', nullable: true })
  zatcaCertificate: string;

  /** CSID secret returned with the certificate (secret). */
  @Column({ name: 'zatca_csid_secret', type: 'text', nullable: true })
  zatcaCsidSecret: string;

  /** EGS secp256k1 private key PEM (secret). */
  @Column({ name: 'zatca_private_key', type: 'text', nullable: true })
  zatcaPrivateKey: string;

  /** Issue simplified (B2C) invoices when the customer has no VAT number. */
  @Column({ name: 'zatca_simplified_default', default: true })
  zatcaSimplifiedDefault: boolean;
}
