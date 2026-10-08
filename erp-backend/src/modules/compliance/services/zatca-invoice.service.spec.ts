import { createHash } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { ZatcaInvoiceService } from './zatca-invoice.service';
import { EInvoiceStatus } from '../entities/e-invoice.entity';
import { ComplianceCountry } from '../entities/compliance-settings.entity';
import { ReceiverType } from '../entities/compliance-party.entity';
import { ZatcaInvoiceKind, zatcaHashInput } from '../zatca/zatca-xml.builder';
import { ZATCA_INITIAL_PIH } from '../zatca/zatca-crypto';
import { ComplianceTransportError } from '../http/compliance-http.client';
import { TEST_CERTIFICATE, TEST_PRIVATE_KEY } from '../zatca/zatca.fixtures';
import { decodeTlv } from '../zatca/zatca-tlv';
import { etaSettings, loadedInvoice, mockRepo } from './compliance.test-helpers';

const saSettings = (over: Record<string, any> = {}) =>
  etaSettings({
    country: ComplianceCountry.SA,
    taxpayerId: '399999999900003',
    taxpayerName: 'Maximum Speed Tech Supply LTD',
    commercialRegistration: '1010010000',
    addressCountry: 'SA',
    street: 'Prince Sultan',
    buildingNumber: '2322',
    district: 'Al-Murabba',
    regionCity: 'Riyadh',
    postalCode: '23333',
    zatcaPrivateKey: TEST_PRIVATE_KEY,
    zatcaCertificate: TEST_CERTIFICATE,
    zatcaCsidSecret: 'secret',
    ...over,
  });

describe('ZatcaInvoiceService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let chain: { counter: number; lastHash: string | null };
  let chains: any;
  let settingsService: any;
  let source: any;
  let api: any;
  let service: ZatcaInvoiceService;
  const conn = { baseUrl: 'z', binarySecurityToken: 't', secret: 's' };

  beforeEach(() => {
    repo = mockRepo();
    chain = { counter: 0, lastHash: null };
    chains = {
      lock: jest.fn(async () => chain),
      peek: jest.fn(async () => ({ ...chain })),
      save: jest.fn(async (c) => c),
    };
    settingsService = {
      resolve: jest.fn().mockResolvedValue(saSettings()),
      zatcaConnection: jest.fn().mockReturnValue(conn),
    };
    source = {
      loadInvoice: jest.fn().mockResolvedValue(
        loadedInvoice({ party: null, customer: { id: 'cust-1', nameAr: 'عميل نقدي', taxId: null } }),
      ),
      findInvoice: jest.fn(),
    };
    api = {
      report: jest.fn().mockResolvedValue({ status: EInvoiceStatus.REPORTED, errors: [], warnings: [], data: {} }),
      clear: jest.fn(),
    };
    service = new ZatcaInvoiceService(repo as any, settingsService, chains, source, api);
  });

  it('reports a simplified invoice and advances the ICV / PIH chain', async () => {
    const first = await service.submit('t1', 'u1', 'inv-1');
    expect(first).toMatchObject({
      status: EInvoiceStatus.REPORTED,
      documentType: '388',
      documentSubtype: ZatcaInvoiceKind.SIMPLIFIED,
      icv: 1,
      previousHash: ZATCA_INITIAL_PIH,
      totalAmount: 228,
    });
    expect(chain).toEqual({ counter: 1, lastHash: first.invoiceHash });
    expect(api.report).toHaveBeenCalledWith(conn, { invoiceHash: first.invoiceHash, uuid: first.uuid, xml: first.xml });
    expect(decodeTlv(first.qrContent).map((t) => t.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // issue time is converted to Riyadh time (UTC+3)
    expect(first.xml).toContain('<cbc:IssueTime>12:00:00</cbc:IssueTime>');

    source.loadInvoice.mockResolvedValue(
      loadedInvoice({
        party: null,
        customer: { id: 'cust-1', nameAr: 'عميل' },
        invoice: { ...loadedInvoice().invoice, id: 'inv-2', invoiceNumber: 'INV-000002' },
      }),
    );
    const second = await service.submit('t1', 'u1', 'inv-2');
    expect(second.icv).toBe(2);
    expect(second.previousHash).toBe(first.invoiceHash);
    expect(chain.lastHash).toBe(second.invoiceHash);
  });

  it('stores a hash equal to SHA-256 of the canonical XML', async () => {
    const rec = await service.submit('t1', null, 'inv-1');
    const stripped = rec.xml
      .replace(/^<\?xml[^>]*\?>\n/, '')
      .replace(/<ext:UBLExtensions>.*<\/ext:UBLExtensions>/, '')
      .replace(/<cac:Signature>.*?<\/cac:Signature>/, '')
      .replace(/<cac:AdditionalDocumentReference><cbc:ID>QR<\/cbc:ID>.*?<\/cac:AdditionalDocumentReference>/, '');
    expect(createHash('sha256').update(stripped).digest('base64')).toBe(rec.invoiceHash);
    expect(typeof zatcaHashInput).toBe('function');
  });

  it('clears standard invoices for VAT-registered buyers and keeps the stamped XML', async () => {
    source.loadInvoice.mockResolvedValue(
      loadedInvoice({
        customer: { id: 'cust-1', nameAr: 'Fatoora Samples LTD' },
        party: {
          receiverType: ReceiverType.BUSINESS,
          identifier: '399999999800003',
          countryCode: 'SA',
          street: 'Salah Al-Din',
          buildingNumber: '1111',
          district: 'Al-Murooj',
          regionCity: 'Riyadh',
          postalCode: '12222',
        },
      }),
    );
    const cleared =
      '<Invoice><cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">ZATCAQR</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>';
    api.clear.mockResolvedValue({ status: EInvoiceStatus.CLEARED, errors: [], warnings: [], data: {}, clearedXml: cleared });
    const rec = await service.submit('t1', null, 'inv-1');
    expect(api.clear).toHaveBeenCalled();
    expect(rec).toMatchObject({ status: EInvoiceStatus.CLEARED, documentSubtype: 'standard', xml: cleared, qrContent: 'ZATCAQR' });
  });

  it('retries a failed submission with the same XML and chain position', async () => {
    api.report.mockRejectedValueOnce(new ComplianceTransportError('ECONNRESET'));
    const failed = await service.submit('t1', null, 'inv-1');
    expect(failed.status).toBe(EInvoiceStatus.FAILED);
    repo.findOne.mockResolvedValue({ ...failed });
    const retried = await service.submit('t1', null, 'inv-1');
    expect(retried.status).toBe(EInvoiceStatus.REPORTED);
    expect(retried.xml).toBe(failed.xml);
    expect(retried.icv).toBe(1);
    expect(chains.lock).toHaveBeenCalledTimes(1);
    expect(retried.attempts).toBe(2);
  });

  it('regenerates rejected invoices on a new chain position', async () => {
    api.report.mockResolvedValueOnce({
      status: EInvoiceStatus.INVALID,
      errors: [{ message: 'bad', severity: 'error' }],
      warnings: [],
      data: {},
    });
    const invalid = await service.submit('t1', null, 'inv-1');
    expect(invalid.status).toBe(EInvoiceStatus.INVALID);
    repo.findOne.mockResolvedValue({ ...invalid });
    const again = await service.submit('t1', null, 'inv-1');
    expect(again.icv).toBe(2);
    expect(again.previousHash).toBe(invalid.invoiceHash);
  });

  it('refuses to resubmit reported invoices', async () => {
    repo.findOne.mockResolvedValue({ status: EInvoiceStatus.REPORTED });
    await expect(service.submit('t1', null, 'inv-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('generates a phase-1 invoice locally when no CSID is configured', async () => {
    settingsService.resolve.mockResolvedValue(saSettings({ zatcaPrivateKey: null, zatcaCertificate: null, zatcaCsidSecret: null }));
    settingsService.zatcaConnection.mockReturnValue(null);
    const rec = await service.submit('t1', null, 'inv-1');
    expect(rec.status).toBe(EInvoiceStatus.PENDING);
    expect(decodeTlv(rec.qrContent).map((t) => t.tag)).toEqual([1, 2, 3, 4, 5]);
    expect(api.report).not.toHaveBeenCalled();
  });

  it('previews without consuming the chain', async () => {
    const preview = await service.preview('t1', 'inv-1');
    expect(preview.icv).toBe(1);
    expect(chains.lock).not.toHaveBeenCalled();
    expect(chains.save).not.toHaveBeenCalled();
  });
});
