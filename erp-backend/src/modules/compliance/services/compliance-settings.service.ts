import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  ComplianceCountry,
  ComplianceSettings,
  EtaEnvironment,
  EtaPosDevice,
  ZatcaEnvironment,
} from '../entities/compliance-settings.entity';
import { ComplianceParty } from '../entities/compliance-party.entity';
import { UpdateComplianceSettingsDto } from '../dto/compliance-settings.dto';
import { UpsertCompliancePartyDto } from '../dto/compliance-party.dto';
import { maskSecret, SecretBox } from '../utils/secret-box';
import { EtaConnection, ETA_URLS } from '../eta/eta-api.client';
import { ZatcaConnection, ZATCA_URLS } from '../zatca/zatca-api.client';
import { normalizeCertificate } from '../zatca/zatca-crypto';

const SECRET_FIELDS = ['etaClientSecret', 'zatcaCsidSecret', 'zatcaPrivateKey'] as const;

@Injectable()
export class ComplianceSettingsService {
  private readonly box: SecretBox;

  constructor(
    @InjectRepository(ComplianceSettings)
    private readonly settingsRepo: Repository<ComplianceSettings>,
    @InjectRepository(ComplianceParty)
    private readonly partyRepo: Repository<ComplianceParty>,
    private readonly config: ConfigService,
  ) {
    this.box = new SecretBox(this.config.get<string>('compliance.secretKey'));
  }

  /** Stored settings, or unsaved defaults when the tenant has none yet. */
  async find(tenantId: string): Promise<ComplianceSettings> {
    const existing = await this.settingsRepo.findOne({ where: { tenantId } });
    return (
      existing ||
      this.settingsRepo.create({
        tenantId,
        country: ComplianceCountry.EG,
        isEnabled: false,
        autoSubmit: false,
        branchCode: '0',
        addressCountry: 'EG',
        etaEnvironment: EtaEnvironment.PREPROD,
        etaDocumentVersion: '1.0',
        defaultUnitType: 'EA',
        defaultTaxSubtype: 'V009',
        unitTypeMap: {},
        posDevices: [],
        zatcaEnvironment: ZatcaEnvironment.SANDBOX,
        zatcaSimplifiedDefault: true,
      })
    );
  }

  /** Settings with secrets decrypted, for internal use only (never return it). */
  async resolve(tenantId: string): Promise<ComplianceSettings> {
    const s = await this.find(tenantId);
    const out = Object.assign(Object.create(Object.getPrototypeOf(s)), s) as ComplianceSettings;
    for (const f of SECRET_FIELDS) (out as any)[f] = this.box.open((s as any)[f]);
    out.posDevices = (s.posDevices || []).map((d) => ({
      ...d,
      presharedKey: this.box.open(d.presharedKey) || undefined,
      clientSecret: this.box.open(d.clientSecret) || undefined,
    }));
    return out;
  }

  /** API view: secrets masked. */
  async getView(tenantId: string) {
    return this.toView(await this.find(tenantId));
  }

  toView(s: ComplianceSettings) {
    const view: Record<string, any> = { ...s };
    for (const f of SECRET_FIELDS) view[f] = maskSecret((s as any)[f]);
    view.posDevices = (s.posDevices || []).map((d) => ({
      ...d,
      presharedKey: maskSecret(d.presharedKey),
      clientSecret: maskSecret(d.clientSecret),
    }));
    view.configured = {
      eta: !!(s.taxpayerId && s.etaClientId && s.etaClientSecret && s.activityCode),
      zatca: !!(s.taxpayerId && s.zatcaCertificate && s.zatcaPrivateKey && s.zatcaCsidSecret),
    };
    return view;
  }

  async update(tenantId: string, dto: UpdateComplianceSettingsDto) {
    const settings = await this.find(tenantId);
    const { posDevices, ...rest } = dto;

    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      if ((SECRET_FIELDS as readonly string[]).includes(key)) {
        (settings as any)[key] = value === '' ? null : this.box.seal(String(value));
      } else {
        (settings as any)[key] = value;
      }
    }
    if (dto.zatcaCertificate) {
      try {
        settings.zatcaCertificate = normalizeCertificate(dto.zatcaCertificate).pem;
      } catch {
        throw new BadRequestException('zatcaCertificate is not a valid certificate');
      }
    }
    if (posDevices) {
      const previous = new Map((settings.posDevices || []).map((d) => [d.serial, d]));
      settings.posDevices = posDevices.map((d) => {
        const old = previous.get(d.serial);
        const keep = (field: 'presharedKey' | 'clientSecret') =>
          d[field] === undefined ? old?.[field] : d[field] === '' ? undefined : this.box.seal(d[field]!) || undefined;
        return { ...d, presharedKey: keep('presharedKey'), clientSecret: keep('clientSecret') } as EtaPosDevice;
      });
    }
    const saved = await this.settingsRepo.save(settings);
    return this.toView(saved);
  }

  // ---- connections ---------------------------------------------------------

  etaUrls(s: ComplianceSettings) {
    if (s.etaEnvironment === EtaEnvironment.PROD) {
      // Environment overrides only apply to production (preprod uses ETA's preprod hosts).
      return {
        api: this.config.get<string>('eta.apiUrl') || ETA_URLS.prod.api,
        idSrv: this.config.get<string>('eta.idSrvUrl') || ETA_URLS.prod.idSrv,
        portal: ETA_URLS.prod.portal,
      };
    }
    return { ...ETA_URLS.preprod };
  }

  etaConnection(s: ComplianceSettings, device?: EtaPosDevice): EtaConnection {
    const urls = this.etaUrls(s);
    const clientId = device?.clientId || s.etaClientId || this.config.get<string>('eta.clientId') || '';
    const clientSecret =
      device?.clientSecret || s.etaClientSecret || this.config.get<string>('eta.clientSecret') || '';
    if (!clientId || !clientSecret) {
      throw new BadRequestException('ETA client id and secret are not configured');
    }
    const conn: EtaConnection = {
      apiBaseUrl: urls.api,
      idSrvUrl: urls.idSrv,
      portalUrl: urls.portal,
      clientId,
      clientSecret,
    };
    if (device) {
      conn.posHeaders = {
        posserial: device.serial,
        pososversion: device.osVersion || 'os',
        posmodelframework: device.modelFramework || '1',
        presharedkey: device.presharedKey || '',
      };
    }
    return conn;
  }

  zatcaBaseUrl(s: ComplianceSettings): string {
    if (s.zatcaEnvironment === ZatcaEnvironment.PRODUCTION && this.config.get<string>('zatca.apiUrl')) {
      return this.config.get<string>('zatca.apiUrl')!;
    }
    return ZATCA_URLS[s.zatcaEnvironment || ZatcaEnvironment.SANDBOX];
  }

  /** null when the tenant has no production CSID yet (phase 1 only). */
  zatcaConnection(s: ComplianceSettings): ZatcaConnection | null {
    if (!s.zatcaCertificate || !s.zatcaCsidSecret) return null;
    const { body } = normalizeCertificate(s.zatcaCertificate);
    return {
      baseUrl: this.zatcaBaseUrl(s),
      binarySecurityToken: Buffer.from(body, 'utf8').toString('base64'),
      secret: s.zatcaCsidSecret,
    };
  }

  // ---- parties ---------------------------------------------------------------

  findParty(tenantId: string, customerId: string): Promise<ComplianceParty | null> {
    return this.partyRepo.findOne({ where: { tenantId, customerId } });
  }

  async upsertParty(tenantId: string, customerId: string, dto: UpsertCompliancePartyDto) {
    const party =
      (await this.findParty(tenantId, customerId)) || this.partyRepo.create({ tenantId, customerId });
    Object.assign(party, dto);
    return this.partyRepo.save(party);
  }
}
