import { BadRequestException, ConflictException } from '@nestjs/common';
import { EtaInvoiceService } from './eta-invoice.service';
import { EInvoiceProvider, EInvoiceStatus } from '../entities/e-invoice.entity';
import { SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import { EtaApiError } from '../eta/eta-errors';
import { ComplianceTransportError } from '../http/compliance-http.client';
import { etaSerializeForSigning } from '../eta/eta-serializer';
import { etaSettings, itemCodeMap, loadedInvoice, mockRepo, postedInvoice } from './compliance.test-helpers';

describe('EtaInvoiceService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let settingsService: any;
  let source: any;
  let itemCodes: any;
  let signer: any;
  let api: any;
  let service: EtaInvoiceService;
  const conn = { apiBaseUrl: 'a', idSrvUrl: 'i', portalUrl: 'https://preprod.invoicing.eta.gov.eg', clientId: 'c', clientSecret: 's' };

  beforeEach(() => {
    repo = mockRepo();
    settingsService = {
      resolve: jest.fn().mockResolvedValue(etaSettings()),
      etaConnection: jest.fn().mockReturnValue(conn),
      etaUrls: jest.fn().mockReturnValue({ portal: conn.portalUrl }),
    };
    source = { loadInvoice: jest.fn().mockResolvedValue(loadedInvoice()) };
    itemCodes = { mapForProducts: jest.fn().mockResolvedValue(itemCodeMap()) };
    signer = { sign: jest.fn().mockResolvedValue('CADES-SIG') };
    api = {
      submitDocuments: jest.fn(),
      getDocumentDetails: jest.fn(),
      getSubmission: jest.fn(),
      cancelDocument: jest.fn(),
    };
    service = new EtaInvoiceService(repo as any, settingsService, source, itemCodes, signer, api);
  });

  it('builds, signs and submits a posted invoice', async () => {
    api.submitDocuments.mockResolvedValue({
      submissionId: 'SUB-1',
      acceptedDocuments: [{ uuid: 'UUID-1', longId: 'LONG-1', internalId: 'INV-000001', hashKey: 'HK' }],
      rejectedDocuments: [],
    });
    const rec = await service.submit('t1', 'user-1', 'inv-1');

    const sent = api.submitDocuments.mock.calls[0][1][0];
    expect(signer.sign).toHaveBeenCalledWith(etaSerializeForSigning(sent), undefined);
    expect(sent.signatures).toEqual([{ signatureType: 'I', value: 'CADES-SIG' }]);
    expect(sent.dateTimeIssued).toBe('2026-01-10T09:00:00Z');
    expect(sent.invoiceLines[0]).toMatchObject({ itemType: 'EGS', itemCode: 'EG-113317713-1001', unitType: 'EA', internalCode: 'P-1' });
    expect(sent.receiver).toMatchObject({ type: 'B', id: '313717919', name: 'Receiver Co' });
    expect(rec).toMatchObject({
      provider: EInvoiceProvider.ETA,
      status: EInvoiceStatus.SUBMITTED,
      submissionUuid: 'SUB-1',
      uuid: 'UUID-1',
      longId: 'LONG-1',
      invoiceHash: 'HK',
      internalId: 'INV-000001',
      documentType: 'I',
      totalAmount: 228,
      attempts: 1,
      submittedBy: 'user-1',
    });
  });

  it('does not sign version 0.9 documents', async () => {
    settingsService.resolve.mockResolvedValue(etaSettings({ etaDocumentVersion: '0.9' }));
    api.submitDocuments.mockResolvedValue({ submissionId: 'S', acceptedDocuments: [{ uuid: 'U' }], rejectedDocuments: [] });
    await service.submit('t1', null, 'inv-1');
    expect(signer.sign).not.toHaveBeenCalled();
    expect(api.submitDocuments.mock.calls[0][1][0].signatures).toBeUndefined();
  });

  it('stores rejected documents as invalid with their errors', async () => {
    api.submitDocuments.mockResolvedValue({
      submissionId: 'S',
      acceptedDocuments: [],
      rejectedDocuments: [{ internalId: 'INV-000001', error: { code: 'BadStructure', message: 'Invalid', details: [{ code: 'X', message: 'receiver.id required' }] } }],
    });
    const rec = await service.submit('t1', null, 'inv-1');
    expect(rec.status).toBe(EInvoiceStatus.INVALID);
    expect(rec.validationErrors.map((e) => e.message)).toEqual(['Invalid', 'receiver.id required']);
  });

  it('marks transport and server errors as failed (retryable) and 4xx as invalid', async () => {
    api.submitDocuments.mockRejectedValueOnce(new ComplianceTransportError('timeout'));
    expect((await service.submit('t1', null, 'inv-1')).status).toBe(EInvoiceStatus.FAILED);
    api.submitDocuments.mockRejectedValueOnce(new EtaApiError(503, 'down'));
    expect((await service.submit('t1', null, 'inv-1')).status).toBe(EInvoiceStatus.FAILED);
    api.submitDocuments.mockRejectedValueOnce(new EtaApiError(422, { error: { code: 'Duplicate', message: 'dup' } }));
    const rec = await service.submit('t1', null, 'inv-1');
    expect(rec.status).toBe(EInvoiceStatus.INVALID);
    expect(rec.validationErrors[0].code).toBe('Duplicate');
  });

  it('refuses to resubmit a submitted or valid document', async () => {
    repo.findOne.mockResolvedValue({ status: EInvoiceStatus.VALID });
    await expect(service.submit('t1', null, 'inv-1')).rejects.toBeInstanceOf(ConflictException);
    expect(api.submitDocuments).not.toHaveBeenCalled();
  });

  it('requires ETA item codes for every product', async () => {
    itemCodes.mapForProducts.mockResolvedValue(new Map());
    await expect(service.submit('t1', null, 'inv-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('references the original document uuid on credit notes', async () => {
    source.loadInvoice.mockResolvedValue(
      loadedInvoice({ invoice: postedInvoice({ moveType: SalesInvoiceType.CREDIT_NOTE, reversedInvoiceId: 'inv-0' }) }),
    );
    repo.findOne.mockImplementation(async ({ where }: any) =>
      where.invoiceId === 'inv-0' ? { uuid: 'ORIGINAL-UUID', status: EInvoiceStatus.VALID } : null,
    );
    const { document } = await service.preview('t1', 'inv-1');
    expect(document.documentType).toBe('C');
    expect(document.references).toEqual(['ORIGINAL-UUID']);
  });

  it('uses the unit mapping and the invoice date when posted on another day', async () => {
    settingsService.resolve.mockResolvedValue(etaSettings({ unitTypeMap: { u1: 'KGM' } }));
    source.loadInvoice.mockResolvedValue(
      loadedInvoice({ invoice: postedInvoice({ postedAt: new Date('2026-01-12T09:00:00Z') }) }),
    );
    const { document } = await service.preview('t1', 'inv-1');
    expect(document.invoiceLines[0].unitType).toBe('KGM');
    expect(document.dateTimeIssued).toBe('2026-01-10T00:00:00Z');
  });

  it('refreshes status: valid documents get the public print URL', async () => {
    api.getDocumentDetails.mockResolvedValue({ status: 'Valid', longId: 'LONG-2', dateTimeValidated: '2026-01-10T09:01:00Z' });
    const rec = await service.refresh('t1', { uuid: 'U1', status: EInvoiceStatus.SUBMITTED } as any);
    expect(rec.status).toBe(EInvoiceStatus.VALID);
    expect(rec.qrContent).toBe('https://preprod.invoicing.eta.gov.eg/print/documents/U1/share/LONG-2');
    expect(rec.validatedAt).toEqual(new Date('2026-01-10T09:01:00Z'));
  });

  it('refreshes status: invalid documents keep their validation errors', async () => {
    api.getDocumentDetails.mockResolvedValue({
      status: 'Invalid',
      validationResults: { validationSteps: [{ name: 'Signature', status: 'Invalid', error: { errorCode: 'Sig', error: 'bad' } }] },
    });
    const rec = await service.refresh('t1', { uuid: 'U1', status: EInvoiceStatus.SUBMITTED } as any);
    expect(rec.status).toBe(EInvoiceStatus.INVALID);
    expect(rec.validationErrors[0]).toMatchObject({ code: 'Sig', message: 'bad', category: 'Signature' });
  });

  it('cancels valid documents only', async () => {
    await expect(service.cancel('t1', { status: EInvoiceStatus.SUBMITTED } as any, 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
    api.cancelDocument.mockResolvedValue(true);
    const rec = await service.cancel('t1', { uuid: 'U1', status: EInvoiceStatus.VALID } as any, 'wrong price');
    expect(api.cancelDocument).toHaveBeenCalledWith(conn, 'U1', 'wrong price');
    expect(rec).toMatchObject({ status: EInvoiceStatus.CANCELLED, cancelReason: 'wrong price' });
  });
});
