import { BadRequestException, ConflictException } from '@nestjs/common';
import { EReceiptService, receiptChainKey } from './e-receipt.service';
import { EInvoiceStatus } from '../entities/e-invoice.entity';
import { PosOrderStatus, PosPaymentMethod } from '@modules/pos/entities/pos-order.entity';
import { computeReceiptUuid } from '../eta/eta-receipt.builder';
import { EtaApiError } from '../eta/eta-errors';
import { etaSettings, itemCodeMap, mockRepo } from './compliance.test-helpers';

const order = (over: Record<string, any> = {}) => ({
  id: 'o1',
  tenantId: 't1',
  sessionId: 's1',
  orderNumber: 'POS-000001',
  customerId: null,
  status: PosOrderStatus.COMPLETED,
  paymentMethod: PosPaymentMethod.CARD,
  createdAt: new Date('2026-01-10T10:00:00Z'),
  refundedOrderId: null,
  lines: [{ productId: 'p1', quantity: 1, unitPrice: 100, discount: 0, taxRate: 14, lineTotal: 114 }],
  ...over,
});

describe('EReceiptService', () => {
  let receiptRepo: ReturnType<typeof mockRepo>;
  let orderRepo: ReturnType<typeof mockRepo>;
  let sessionRepo: ReturnType<typeof mockRepo>;
  let chainState: Record<string, { counter: number; lastHash: string | null; chainKey: string }>;
  let chains: any;
  let settingsService: any;
  let api: any;
  let service: EReceiptService;
  const conn = { apiBaseUrl: 'a', idSrvUrl: 'i', portalUrl: 'https://preprod.invoicing.eta.gov.eg', clientId: 'c', clientSecret: 's' };

  beforeEach(() => {
    receiptRepo = mockRepo();
    orderRepo = mockRepo();
    sessionRepo = mockRepo();
    orderRepo.findOne.mockResolvedValue(order());
    sessionRepo.findOne.mockResolvedValue({ id: 's1', terminalId: 'term-1' });
    chainState = {};
    chains = {
      lock: jest.fn(async (_t: string, key: string) => (chainState[key] ||= { chainKey: key, counter: 0, lastHash: null })),
      peek: jest.fn(async (_t: string, key: string) => chainState[key] || { counter: 0, lastHash: null }),
      save: jest.fn(async (c) => c),
    };
    settingsService = {
      resolve: jest.fn().mockResolvedValue(etaSettings()),
      etaConnection: jest.fn().mockReturnValue(conn),
      etaUrls: jest.fn().mockReturnValue({ portal: conn.portalUrl }),
    };
    const source = {
      loadProducts: jest.fn().mockResolvedValue(new Map([['p1', { id: 'p1', code: 'P-1', nameEn: 'Juice' }]])),
      findCustomer: jest.fn(),
    };
    const itemCodes = { mapForProducts: jest.fn().mockResolvedValue(itemCodeMap()) };
    api = {
      submitReceipts: jest.fn().mockResolvedValue({
        submissionId: 'RS-1',
        acceptedDocuments: [{ uuid: 'x', receiptNumber: 'POS-000001' }],
        rejectedDocuments: [],
      }),
      getReceiptSubmission: jest.fn(),
    };
    service = new EReceiptService(
      receiptRepo as any,
      orderRepo as any,
      sessionRepo as any,
      settingsService,
      chains,
      source as any,
      itemCodes as any,
      api,
    );
  });

  it('submits a receipt with the POS device headers and a computed uuid', async () => {
    const rec = await service.submit('t1', 'o1');
    expect(settingsService.etaConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serial: 'SN-1' }),
    );
    expect(rec.status).toBe(EInvoiceStatus.SUBMITTED);
    expect(rec.submissionUuid).toBe('RS-1');
    expect(rec.uuid).toBe(computeReceiptUuid(rec.payload));
    expect(rec.previousUuid).toBe('');
    expect(rec.payload.paymentMethod).toBe('V');
    expect(rec.payload.seller.deviceSerialNumber).toBe('SN-1');
    expect(rec.qrContent).toBe(
      `https://preprod.invoicing.eta.gov.eg/receipts/search/${rec.uuid}/share/2026-01-10T10:00:00Z#Total:114,IssuerRIN:113317713`,
    );
  });

  it('chains previousUUID per POS device', async () => {
    const first = await service.submit('t1', 'o1');
    orderRepo.findOne.mockResolvedValue(order({ id: 'o2', orderNumber: 'POS-000002' }));
    const second = await service.submit('t1', 'o2');
    expect(second.previousUuid).toBe(first.uuid);
    expect(chainState[receiptChainKey('SN-1')]).toMatchObject({ counter: 2, lastHash: second.uuid });
  });

  it('references the original receipt on returns', async () => {
    orderRepo.findOne.mockResolvedValue(
      order({ id: 'o3', refundedOrderId: 'o1', lines: [{ productId: 'p1', quantity: -1, unitPrice: 100, discount: 0, taxRate: 14 }] }),
    );
    await expect(service.submit('t1', 'o3')).rejects.toBeInstanceOf(BadRequestException);
    receiptRepo.findOne.mockImplementation(async ({ where }: any) =>
      where.posOrderId === 'o1' ? { uuid: 'ORIG' } : null,
    );
    const rec = await service.submit('t1', 'o3');
    expect(rec.receiptType).toBe('R');
    expect(rec.referenceUuid).toBe('ORIG');
    expect(rec.payload.totalAmount).toBe(114);
  });

  it('requires a registered POS device', async () => {
    settingsService.resolve.mockResolvedValue(etaSettings({ posDevices: [{ terminalId: 'other', serial: 'X' }] }));
    await expect(service.submit('t1', 'o1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores rejected receipts as invalid and refuses duplicates', async () => {
    api.submitReceipts.mockRejectedValueOnce(new EtaApiError(400, { error: { code: 'E1', message: 'bad receipt' } }));
    const rec = await service.submit('t1', 'o1');
    expect(rec.status).toBe(EInvoiceStatus.INVALID);
    expect(rec.validationErrors[0].message).toBe('bad receipt');

    receiptRepo.findOne.mockResolvedValue({ status: EInvoiceStatus.SUBMITTED });
    await expect(service.submit('t1', 'o1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('refreshes the status from the receipt submission', async () => {
    receiptRepo.findOne.mockResolvedValue({ id: 'r1', uuid: 'U1', submissionUuid: 'RS-1', deviceSerial: 'SN-1', status: EInvoiceStatus.SUBMITTED });
    api.getReceiptSubmission.mockResolvedValue({ receipts: [{ uuid: 'U1', status: 'Valid' }] });
    const rec = await service.refresh('t1', 'r1');
    expect(rec.status).toBe(EInvoiceStatus.VALID);
  });
});
