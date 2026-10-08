import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ComplianceCountry,
  EtaEnvironment,
  ZatcaEnvironment,
} from '../entities/compliance-settings.entity';

export class EtaPosDeviceDto {
  @ApiPropertyOptional({ description: 'POS terminal bound to this device' })
  @IsOptional()
  @IsUUID()
  terminalId?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(100)
  serial: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  osVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelFramework?: string;

  @ApiPropertyOptional({ description: 'Secret. Omit to keep the stored value, empty string to clear.' })
  @IsOptional()
  @IsString()
  presharedKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientId?: string;

  @ApiPropertyOptional({ description: 'Secret. Omit to keep the stored value.' })
  @IsOptional()
  @IsString()
  clientSecret?: string;
}

/**
 * Secret fields (etaClientSecret, zatcaCsidSecret, zatcaPrivateKey, device
 * keys) are write-only: omit them to keep the stored value, send an empty
 * string to clear them.
 */
export class UpdateComplianceSettingsDto {
  @ApiPropertyOptional({ enum: ComplianceCountry })
  @IsOptional()
  @IsEnum(ComplianceCountry)
  country?: ComplianceCountry;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoSubmit?: boolean;

  @ApiPropertyOptional({ description: 'ETA RIN (9 digits) or ZATCA VAT number (15 digits)' })
  @IsOptional()
  @Matches(/^(\d{9}|\d{15})?$/, { message: 'taxpayerId must be a 9-digit RIN or a 15-digit VAT number' })
  taxpayerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taxpayerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  commercialRegistration?: string;

  @ApiPropertyOptional({ description: 'ETA branch id ("0" = head office)' })
  @IsOptional()
  @IsString()
  branchCode?: string;

  @ApiPropertyOptional({ description: 'ETA taxpayer activity code' })
  @IsOptional()
  @IsString()
  activityCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'addressCountry must be an ISO 3166-1 alpha-2 code' })
  addressCountry?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() governate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() regionCity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() street?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() buildingNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() district?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() floor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() room?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() landmark?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() additionalInformation?: string;

  @ApiPropertyOptional({ enum: EtaEnvironment })
  @IsOptional()
  @IsEnum(EtaEnvironment)
  etaEnvironment?: EtaEnvironment;

  @ApiPropertyOptional() @IsOptional() @IsString() etaClientId?: string;

  @ApiPropertyOptional({ description: 'Secret (write-only)' })
  @IsOptional()
  @IsString()
  etaClientSecret?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() etaSignerUrl?: string;

  @ApiPropertyOptional({ enum: ['1.0', '0.9'] })
  @IsOptional()
  @Matches(/^(1\.0|0\.9)$/)
  etaDocumentVersion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() defaultUnitType?: string;

  @ApiPropertyOptional({ description: 'units.id -> ETA unit type code' })
  @IsOptional()
  @IsObject()
  unitTypeMap?: Record<string, string>;

  @ApiPropertyOptional() @IsOptional() @Matches(/^V0(0[1-9]|10)$/) defaultTaxSubtype?: string;

  @ApiPropertyOptional({ type: [EtaPosDeviceDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EtaPosDeviceDto)
  posDevices?: EtaPosDeviceDto[];

  @ApiPropertyOptional({ enum: ZatcaEnvironment })
  @IsOptional()
  @IsEnum(ZatcaEnvironment)
  zatcaEnvironment?: ZatcaEnvironment;

  @ApiPropertyOptional({ description: 'CSID certificate (PEM, base64 DER or binarySecurityToken)' })
  @IsOptional()
  @IsString()
  zatcaCertificate?: string;

  @ApiPropertyOptional({ description: 'Secret (write-only)' })
  @IsOptional()
  @IsString()
  zatcaCsidSecret?: string;

  @ApiPropertyOptional({ description: 'secp256k1 private key PEM (write-only)' })
  @IsOptional()
  @IsString()
  zatcaPrivateKey?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() zatcaSimplifiedDefault?: boolean;
}
