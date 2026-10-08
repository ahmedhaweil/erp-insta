import api from '@/lib/api';
import { clean } from './finance-admin.service';

/** Treasury (cash boxes / banks, vouchers, transfers, cheques, reconciliation) and payments. */

const d = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export type TreasuryType = 'cash' | 'bank';

export interface Treasury {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  type: TreasuryType;
  accountId: string;
  currencyId: string | null;
  branchId: string | null;
  bankName: string | null;
  bankBranch: string | null;
  accountNumber: string | null;
  iban: string | null;
  swiftCode: string | null;
  openingBalance: number | string;
  openingDate: string | null;
  isActive: boolean;
  notes: string | null;
  balance?: number;
  baseBalance?: number;
}

export interface TreasuryMovement {
  journalLineId: string;
  entryId: string;
  refNumber: string;
  date: string;
  description: string | null;
  sourceType: string | null;
  moneyIn: number;
  moneyOut: number;
  amount: number;
  balance: number;
  baseBalance: number;
  reconciled: boolean;
}

export interface CashBook {
  treasury: Pick<Treasury, 'id' | 'code' | 'nameAr' | 'nameEn' | 'type' | 'currencyId'>;
  from: string | null;
  to: string | null;
  openingBalance: number;
  totalIn: number;
  totalOut: number;
  closingBalance: number;
  closingBaseBalance: number;
  movements: TreasuryMovement[];
}

export type VoucherType = 'receipt' | 'payment';

export interface Voucher {
  id: string;
  voucherNumber: string;
  type: VoucherType;
  date: string;
  treasuryId: string;
  status: 'draft' | 'posted' | 'cancelled';
  amount: number | string;
  exchangeRate: number | string;
  counterpartyName: string | null;
  reference: string | null;
  description: string | null;
  lines?: { id: string; accountId: string; amount: number | string; description: string | null }[];
}

export interface Transfer {
  id: string;
  transferNumber: string;
  date: string;
  fromTreasuryId: string;
  toTreasuryId: string;
  amount: number | string;
  rate: number | string;
  toAmount: number | string;
  baseRate: number | string;
  fee: number | string;
  status: 'draft' | 'posted' | 'cancelled';
  reference: string | null;
  description: string | null;
}

export type ChequeStatus =
  | 'in_portfolio'
  | 'under_collection'
  | 'collected'
  | 'endorsed'
  | 'returned'
  | 'issued'
  | 'cleared'
  | 'bounced'
  | 'cancelled';

export interface Cheque {
  id: string;
  type: 'received' | 'issued';
  status: ChequeStatus;
  chequeNumber: string;
  bankName: string | null;
  bankBranch: string | null;
  drawer: string | null;
  issueDate: string;
  dueDate: string;
  amount: number | string;
  partnerType: 'customer' | 'supplier';
  partnerId: string;
  paymentId: string;
  treasuryId: string | null;
  endorsedSupplierId: string | null;
  statusDate: string | null;
  notes: string | null;
  history: { date: string; action: string; userId: string; note?: string }[];
}

export interface ChequeDue {
  from: string;
  to: string;
  totalReceivable: number;
  totalPayable: number;
  days: { date: string; received: number; issued: number; count: number }[];
  cheques: Cheque[];
}

export interface StatementLine {
  id: string;
  date: string;
  description: string | null;
  reference: string | null;
  amount: number | string;
  isMatched: boolean;
  matches?: { id: string; journalLineId: string; amount: number | string; matchType: string }[];
}

export interface BankStatement {
  id: string;
  treasuryId: string;
  reference: string | null;
  startDate: string;
  endDate: string;
  openingBalance: number | string;
  closingBalance: number | string;
  status: 'open' | 'reconciled';
  lines?: StatementLine[];
}

export interface ReconciliationReport {
  statement: { id: string; reference: string | null; startDate: string; endDate: string; openingBalance: number; closingBalance: number; status: string; lines: number; matchedLines: number };
  treasury: { id: string; code: string; nameAr: string };
  reconciliationStart: string;
  bookBalance: number;
  statementBalance: number;
  depositsInTransit: any[];
  totalDepositsInTransit: number;
  outstandingPayments: any[];
  totalOutstandingPayments: number;
  unmatchedStatementLines: StatementLine[];
  totalUnmatchedStatementLines: number;
  adjustedBankBalance: number;
  adjustedBookBalance: number;
  difference: number;
  isReconciled: boolean;
}

export type PaymentMethod = 'cash' | 'bank' | 'card' | 'cheque';

export interface PaymentRow {
  id: string;
  paymentNumber: string;
  partnerType: 'customer' | 'supplier';
  partnerId: string;
  direction: 'inbound' | 'outbound';
  date: string;
  amount: number | string;
  withholdingAmount: number | string;
  allocatedAmount: number | string;
  method: PaymentMethod;
  reference: string | null;
  status: 'posted' | 'cancelled' | 'bounced';
  currencyId: string | null;
  exchangeRate: number | string;
  treasuryId: string | null;
  chequeId: string | null;
  allocations?: { id: string; invoiceId: string; amount: number | string }[];
}

export interface CreatePaymentPayload {
  partnerType: 'customer' | 'supplier';
  partnerId: string;
  direction?: 'inbound' | 'outbound';
  amount: number;
  date: string;
  method?: PaymentMethod;
  reference?: string;
  currencyId?: string;
  treasuryId?: string;
  exchangeRate?: number;
  withholdingAmount?: number;
  cheque?: { chequeNumber: string; bankName?: string; bankBranch?: string; drawer?: string; dueDate: string; issueDate?: string; notes?: string };
  endorsedChequeId?: string;
  allocations?: { invoiceId: string; amount: number }[];
  autoAllocate?: boolean;
}

export interface Partner {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
}

export interface OpenInvoice {
  id: string;
  number: string;
  date: string;
  dueDate: string | null;
  total: number;
  paid: number;
  residual: number;
  status: string;
}

export const treasuryService = {
  // treasuries
  getTreasuries: (params: { type?: TreasuryType; activeOnly?: boolean; withBalance?: boolean } = {}) =>
    d<Treasury[]>(
      api.get('/treasury/treasuries', {
        params: clean({
          type: params.type,
          activeOnly: params.activeOnly ? 'true' : undefined,
          withBalance: params.withBalance === false ? undefined : 'true',
        }),
      }),
    ),
  getTreasury: (id: string) => d<Treasury>(api.get(`/treasury/treasuries/${id}`)),
  createTreasury: (data: Record<string, unknown>) => d<Treasury>(api.post('/treasury/treasuries', data)),
  updateTreasury: (id: string, data: Record<string, unknown>) => d<Treasury>(api.patch(`/treasury/treasuries/${id}`, data)),
  getMovements: (id: string, from?: string, to?: string) =>
    d<CashBook>(api.get(`/treasury/treasuries/${id}/movements`, { params: clean({ from, to }) })),

  // vouchers
  getVouchers: (params: { type?: VoucherType; treasuryId?: string; from?: string; to?: string } = {}) =>
    d<Voucher[]>(api.get('/treasury/vouchers', { params: clean(params) })),
  createVoucher: (data: Record<string, unknown>) => d<Voucher>(api.post('/treasury/vouchers', data)),
  postVoucher: (id: string) => d<Voucher>(api.post(`/treasury/vouchers/${id}/post`)),
  cancelVoucher: (id: string, data: { date?: string; reason?: string } = {}) =>
    d<Voucher>(api.post(`/treasury/vouchers/${id}/cancel`, data)),

  // transfers
  getTransfers: (params: { treasuryId?: string; from?: string; to?: string } = {}) =>
    d<Transfer[]>(api.get('/treasury/transfers', { params: clean(params) })),
  createTransfer: (data: Record<string, unknown>) => d<Transfer>(api.post('/treasury/transfers', data)),
  postTransfer: (id: string) => d<Transfer>(api.post(`/treasury/transfers/${id}/post`)),
  cancelTransfer: (id: string, data: { date?: string; reason?: string } = {}) =>
    d<Transfer>(api.post(`/treasury/transfers/${id}/cancel`, data)),

  // cheques
  getCheques: (params: { type?: string; status?: string; partnerId?: string; dueFrom?: string; dueTo?: string } = {}) =>
    d<Cheque[]>(api.get('/treasury/cheques', { params: clean(params) })),
  getDueCheques: (from: string, to: string, type?: string) =>
    d<ChequeDue>(api.get('/treasury/cheques/due', { params: clean({ from, to, type }) })),
  chequeAction: (id: string, action: string, data: Record<string, unknown>) =>
    d<Cheque>(api.post(`/treasury/cheques/${id}/${action}`, data)),

  // bank statements
  getStatements: (treasuryId?: string) =>
    d<BankStatement[]>(api.get('/treasury/bank-statements', { params: clean({ treasuryId }) })),
  getStatement: (id: string) => d<BankStatement>(api.get(`/treasury/bank-statements/${id}`)),
  importStatement: (data: Record<string, unknown>) => d<BankStatement>(api.post('/treasury/bank-statements', data)),
  deleteStatement: (id: string) => d<unknown>(api.delete(`/treasury/bank-statements/${id}`)),
  getReconciliation: (id: string) => d<ReconciliationReport>(api.get(`/treasury/bank-statements/${id}/report`)),
  autoMatch: (id: string, dayTolerance?: number) =>
    d<{ matched: number }>(api.post(`/treasury/bank-statements/${id}/auto-match`, dayTolerance != null ? { dayTolerance } : {})),
  closeStatement: (id: string) => d<unknown>(api.post(`/treasury/bank-statements/${id}/close`)),
  reopenStatement: (id: string) => d<unknown>(api.post(`/treasury/bank-statements/${id}/reopen`)),
  matchLine: (lineId: string, journalLineIds: string[]) =>
    d<unknown>(api.post(`/treasury/bank-statements/lines/${lineId}/match`, { journalLineIds })),
  unmatchLine: (lineId: string) => d<unknown>(api.post(`/treasury/bank-statements/lines/${lineId}/unmatch`)),
  lineVoucher: (lineId: string, data: { accountId?: string; description?: string }) =>
    d<unknown>(api.post(`/treasury/bank-statements/lines/${lineId}/voucher`, data)),

  // payments
  getPayments: (params: { partnerId?: string; treasuryId?: string } = {}) =>
    d<PaymentRow[]>(api.get('/payments', { params: clean(params) })),
  createPayment: (data: CreatePaymentPayload) => d<PaymentRow>(api.post('/payments', data)),
  allocatePayment: (id: string, allocations: { invoiceId: string; amount: number }[]) =>
    d<PaymentRow>(api.post(`/payments/${id}/allocate`, { allocations })),
  cancelPayment: (id: string) => d<PaymentRow>(api.post(`/payments/${id}/cancel`)),

  // partners and their open invoices (read-only lookups)
  getCustomers: () => d<Partner[]>(api.get('/sales/customers')),
  getSuppliers: () => d<Partner[]>(api.get('/purchasing/suppliers')),
  /**
   * Documents a payment of this partner can settle (GET /payments/open-documents):
   * invoices / bills for normal payments, credit notes / refunds for refunds.
   */
  getOpenInvoices: async (
    partnerType: 'customer' | 'supplier',
    partnerId: string,
    direction?: 'inbound' | 'outbound',
  ): Promise<OpenInvoice[]> => {
    const rows = await d<any[]>(api.get('/payments/open-documents', { params: clean({ partnerType, partnerId, direction }) }));
    return rows
      .map((r) => {
        const total = Number(r.totalAmount) || 0;
        const paid = Number(r.paidAmount) || 0;
        return {
          id: r.id,
          number: r.invoiceNumber,
          date: r.date,
          dueDate: r.dueDate ?? null,
          total,
          paid,
          residual: Math.round((total - paid) * 100) / 100,
          status: r.status,
        };
      })
      .filter((r) => r.residual > 0.004);
  },
};
