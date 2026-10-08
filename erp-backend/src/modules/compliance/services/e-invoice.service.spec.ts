import { BadRequestException } from '@nestjs/common';
import { EInvoiceService } from './e-invoice.service';
import { ComplianceCountry } from '../entities/compliance-settings.entity';
import { EInvoiceProvider, EInvoiceStatus } from '../entities/e-invoice.entity';
import { zatcaQr } from '../zatca/zatca-tlv';
import { mockRepo } from './compliance.test-helpers';

describe('EInvoiceService (routing)', () => {
  let repo: ReturnType<typeof mockRepo>;
  let settingsService: any;
  let eta: any;
  let zatca: any;
  let service: EInvoiceService;

  beforeEach(() => {
    repo = mockRepo();
    settingsService = { find: jest.fn().mockResolvedValue({ country: ComplianceCountry.EG, isEnabled: true, autoSubmit: true }) };
    eta = { submit: jest.fn().mockResolvedValue({ provider: 'eta' }), refresh: jest.fn(), cancel: jest.fn(), printUrl: jest.fn() };
    zatca = { submit: jest.fn().mockResolvedValue({ provider: 'zatca' }) };
    service = new EInvoiceService(repo as any, settingsService, eta, zatca);
  });

  it('routes submissions by the tenant compliance country', async () => {
    await service.submitInvoice('t1', { invoiceId: 'i1' }, 'u1');
    expect(eta.submit).toHaveBeenCalledWith('t1', 'u1', 'i1');
    settingsService.find.mockResolvedValue({ country: ComplianceCountry.SA });
    await service.submitInvoice('t1', { invoiceId: 'i1' }, 'u1');
    expect(zatca.submit).toHaveBeenCalledWith('t1', 'u1', 'i1');
  });

  it('auto-submits only when enabled and never throws', async () => {
    settingsService.find.mockResolvedValue({ country: ComplianceCountry.EG, isEnabled: true, autoSubmit: false });
    await expect(service.submitIfEnabled('t1', null, 'i1')).resolves.toBeNull();
    expect(eta.submit).not.toHaveBeenCalled();

    settingsService.find.mockResolvedValue({ country: ComplianceCountry.EG, isEnabled: true, autoSubmit: true });
    eta.submit.mockRejectedValueOnce(new BadRequestException('missing item codes'));
    await expect(service.submitIfEnabled('t1', null, 'i1')).resolves.toBeNull();
  });

  it('refuses to cancel ZATCA invoices (credit note required)', async () => {
    repo.findOne.mockResolvedValue({ id: 'e1', provider: EInvoiceProvider.ZATCA });
    await expect(service.cancel('t1', 'e1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not poll ZATCA documents', async () => {
    const rec = { id: 'e1', provider: EInvoiceProvider.ZATCA, status: EInvoiceStatus.REPORTED };
    repo.findOne.mockResolvedValue(rec);
    await expect(service.refreshStatus('t1', 'e1')).resolves.toBe(rec);
    expect(eta.refresh).not.toHaveBeenCalled();
  });

  it('decodes the ZATCA QR fields', async () => {
    const qr = zatcaQr({ sellerName: 'S', vatNumber: '3', timestamp: 't', totalWithVat: 1, vatTotal: 0 });
    repo.findOne.mockResolvedValue({ id: 'e1', provider: EInvoiceProvider.ZATCA, qrContent: qr });
    const res = await service.getQr('t1', 'e1');
    expect(res.qrFields).toEqual([
      { tag: 1, value: 'S' },
      { tag: 2, value: '3' },
      { tag: 3, value: 't' },
      { tag: 4, value: '1.00' },
      { tag: 5, value: '0.00' },
    ]);
  });

  it('refreshes all submitted ETA documents and counts changes', async () => {
    repo.find.mockResolvedValue([
      { id: 'a', tenantId: 't1', status: EInvoiceStatus.SUBMITTED },
      { id: 'b', tenantId: 't2', status: EInvoiceStatus.SUBMITTED },
    ]);
    eta.refresh
      .mockResolvedValueOnce({ status: EInvoiceStatus.VALID })
      .mockRejectedValueOnce(new Error('boom'));
    await expect(service.refreshPending()).resolves.toEqual({ checked: 2, changed: 1 });
  });
});
