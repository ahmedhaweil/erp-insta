import { ComplianceAutoSubmitListener } from './compliance-auto-submit.listener';
import { ComplianceCountry } from '../entities/compliance-settings.entity';

describe('ComplianceAutoSubmitListener', () => {
  const setup = (settings: Record<string, unknown>) => {
    const eInvoices = { submitIfEnabled: jest.fn() };
    const eReceipts = { submit: jest.fn() };
    const settingsService = { find: jest.fn(async () => settings) };
    const listener = new ComplianceAutoSubmitListener(
      eInvoices as any,
      eReceipts as any,
      settingsService as any,
    );
    return { listener, eInvoices, eReceipts };
  };

  it('hands posted invoices to the e-invoice service, which checks the tenant settings', async () => {
    const { listener, eInvoices } = setup({});
    await listener.onInvoicePosted({ tenantId: 't1', userId: 'u1', invoiceId: 'i1' });
    expect(eInvoices.submitIfEnabled).toHaveBeenCalledWith('t1', 'u1', 'i1');
  });

  it('submits Egyptian POS orders as e-receipts when auto-submission is on', async () => {
    const { listener, eReceipts } = setup({ isEnabled: true, autoSubmit: true, country: ComplianceCountry.EG });
    await listener.onPosOrder({ tenantId: 't1', posOrderId: 'o1' });
    expect(eReceipts.submit).toHaveBeenCalledWith('t1', 'o1');
  });

  it.each([
    [{ isEnabled: false, autoSubmit: true, country: ComplianceCountry.EG }],
    [{ isEnabled: true, autoSubmit: false, country: ComplianceCountry.EG }],
    [{ isEnabled: true, autoSubmit: true, country: ComplianceCountry.SA }],
  ])('does not submit e-receipts for %o', async (settings) => {
    const { listener, eReceipts } = setup(settings);
    await listener.onPosOrder({ tenantId: 't1', posOrderId: 'o1' });
    expect(eReceipts.submit).not.toHaveBeenCalled();
  });

  it('never throws when the submission fails', async () => {
    const { listener, eReceipts } = setup({ isEnabled: true, autoSubmit: true, country: ComplianceCountry.EG });
    eReceipts.submit.mockRejectedValue(new Error('ETA down'));
    await expect(listener.onPosOrder({ tenantId: 't1', posOrderId: 'o1' })).resolves.toBeUndefined();
  });
});
