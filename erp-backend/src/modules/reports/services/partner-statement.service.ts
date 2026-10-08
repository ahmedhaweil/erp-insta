import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Not, Repository } from 'typeorm';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '@modules/sales/entities/sales-invoice.entity';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
  PurchaseInvoiceType,
} from '@modules/purchasing/entities/purchase-invoice.entity';
import {
  Payment,
  PaymentDirection,
  PaymentPartnerType,
  PaymentStatus,
} from '@modules/payments/entities/payment.entity';
import { PaymentAllocation } from '@modules/payments/entities/payment-allocation.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { round, today } from '@shared/utils/document-totals.util';

export type StatementDocType =
  | 'invoice'
  | 'credit_note'
  | 'bill'
  | 'vendor_refund'
  | 'payment'
  | 'refund'
  | 'direct_payment';

export interface StatementMovement {
  date: string;
  documentType: StatementDocType;
  documentId: string;
  number: string;
  reference?: string | null;
  dueDate?: string | null;
  description: string;
  /** Increases what the customer owes us / decreases what we owe the supplier. */
  debit: number;
  credit: number;
  currencyId?: string | null;
  /** Ordering tie-breaker within a day. */
  createdAt?: Date;
}

export interface StatementLine extends StatementMovement {
  balance: number;
}

/**
 * Builds the running statement: movements before `from` are summed into the
 * opening balance, the rest are listed with a running balance. `sign` is +1
 * for customers (debit balance) and −1 for suppliers (credit balance).
 */
export function buildStatement(movements: StatementMovement[], from: string | undefined, sign: 1 | -1) {
  const sorted = [...movements].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0) ||
      a.number.localeCompare(b.number),
  );
  let opening = 0;
  const lines: StatementLine[] = [];
  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  for (const m of sorted) {
    const net = sign * (m.debit - m.credit);
    if (from && m.date < from) {
      opening += net;
      continue;
    }
    if (lines.length === 0) running = round(opening, 4);
    running = round(running + net, 4);
    totalDebit += m.debit;
    totalCredit += m.credit;
    const { createdAt: _createdAt, ...rest } = m;
    lines.push({ ...rest, balance: running });
  }
  const openingBalance = round(opening, 4);
  return {
    openingBalance,
    lines,
    totalDebit: round(totalDebit, 4),
    totalCredit: round(totalCredit, 4),
    closingBalance: round(openingBalance + sign * (totalDebit - totalCredit), 4),
  };
}

/**
 * Customer / supplier statement of account (كشف حساب) built from the
 * documents: posted invoices and credit notes (bills and refunds), posted
 * payments and refunds, and legacy "mark paid" settlements. Amounts are in
 * document currency, consistent with the partner balance.
 */
@Injectable()
export class PartnerStatementService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentAllocation)
    private readonly allocationRepo: Repository<PaymentAllocation>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
  ) {}

  async getStatement(
    tenantId: string,
    q: { partnerType: 'customer' | 'supplier'; partnerId: string; from?: string; to?: string },
  ) {
    const to = q.to ?? today();
    const isCustomer = q.partnerType === 'customer';
    const partner = isCustomer
      ? await this.customerRepo.findOne({ where: { id: q.partnerId, tenantId } })
      : await this.supplierRepo.findOne({ where: { id: q.partnerId, tenantId } });
    if (!partner) throw new NotFoundException(`${isCustomer ? 'Customer' : 'Supplier'} not found`);

    const movements: StatementMovement[] = [];
    const invoiceNumbers = new Map<string, string>();

    if (isCustomer) {
      const invoices = await this.salesInvoiceRepo.find({
        where: {
          tenantId,
          customerId: q.partnerId,
          status: Not(In([SalesInvoiceStatus.DRAFT, SalesInvoiceStatus.CANCELLED])),
          date: LessThanOrEqual(to),
        },
      });
      for (const inv of invoices) {
        invoiceNumbers.set(inv.id, inv.invoiceNumber);
        const isCredit = inv.moveType === SalesInvoiceType.CREDIT_NOTE;
        movements.push({
          date: inv.date,
          documentType: isCredit ? 'credit_note' : 'invoice',
          documentId: inv.id,
          number: inv.invoiceNumber,
          dueDate: isCredit ? null : inv.dueDate,
          description: isCredit ? 'Credit note' : 'Sales invoice',
          debit: isCredit ? 0 : Number(inv.totalAmount),
          credit: isCredit ? Number(inv.totalAmount) : 0,
          currencyId: inv.currencyId,
          createdAt: inv.createdAt,
        });
      }
      movements.push(
        ...(await this.directSettlements(tenantId, 'sales_invoice_payment', invoiceNumbers, to, 'credit')),
      );
    } else {
      const bills = await this.purchaseInvoiceRepo.find({
        where: {
          tenantId,
          supplierId: q.partnerId,
          status: Not(In([PurchaseInvoiceStatus.DRAFT, PurchaseInvoiceStatus.CANCELLED])),
          date: LessThanOrEqual(to),
        },
      });
      for (const bill of bills) {
        invoiceNumbers.set(bill.id, bill.invoiceNumber);
        const isRefund = bill.moveType === PurchaseInvoiceType.REFUND;
        movements.push({
          date: bill.date,
          documentType: isRefund ? 'vendor_refund' : 'bill',
          documentId: bill.id,
          number: bill.invoiceNumber,
          reference: bill.supplierReference,
          dueDate: isRefund ? null : bill.dueDate,
          description: isRefund ? 'Vendor refund' : 'Vendor bill',
          debit: isRefund ? Number(bill.totalAmount) : 0,
          credit: isRefund ? 0 : Number(bill.totalAmount),
          currencyId: bill.currencyId,
          createdAt: bill.createdAt,
        });
      }
      movements.push(
        ...(await this.directSettlements(tenantId, 'purchase_invoice_payment', invoiceNumbers, to, 'debit')),
      );
    }

    const payments = await this.paymentRepo.find({
      where: {
        tenantId,
        partnerId: q.partnerId,
        partnerType: isCustomer ? PaymentPartnerType.CUSTOMER : PaymentPartnerType.SUPPLIER,
        status: PaymentStatus.POSTED,
        date: LessThanOrEqual(to),
      },
    });
    const allocations = payments.length
      ? await this.allocationRepo.find({ where: { paymentId: In(payments.map((p) => p.id)) } })
      : [];
    for (const payment of payments) {
      const inbound = payment.direction === PaymentDirection.INBOUND;
      // Money received is a credit on both statements (a customer paying us,
      // or a supplier refunding us); money paid out is a debit.
      const amount = Number(payment.amount);
      const applied = allocations
        .filter((a) => a.paymentId === payment.id)
        .map((a) => invoiceNumbers.get(a.invoiceId) ?? a.invoiceId);
      const isRefund = isCustomer ? !inbound : inbound;
      movements.push({
        date: payment.date,
        documentType: isRefund ? 'refund' : 'payment',
        documentId: payment.id,
        number: payment.paymentNumber,
        reference: payment.reference,
        description:
          `${isRefund ? 'Refund' : 'Payment'} (${payment.method})` +
          (applied.length ? ` - ${applied.join(', ')}` : ''),
        debit: inbound ? 0 : amount,
        credit: inbound ? amount : 0,
        currencyId: payment.currencyId,
        createdAt: payment.createdAt,
      });
    }

    const statement = buildStatement(movements, q.from, isCustomer ? 1 : -1);
    return {
      partnerType: q.partnerType,
      partner: {
        id: partner.id,
        code: partner.code,
        nameAr: partner.nameAr,
        nameEn: partner.nameEn,
        phone: partner.phone,
        taxId: partner.taxId,
        currentBalance: Number(partner.balance),
      },
      from: q.from ?? null,
      to,
      balanceNature: isCustomer ? 'debit' : 'credit',
      ...statement,
    };
  }

  /**
   * Legacy settlements registered with "mark paid" on an invoice/bill: they
   * have no payment record, only a posted, non-reversed journal entry whose
   * source is the invoice.
   */
  private async directSettlements(
    tenantId: string,
    sourceType: 'sales_invoice_payment' | 'purchase_invoice_payment',
    invoiceNumbers: Map<string, string>,
    to: string,
    side: 'debit' | 'credit',
  ): Promise<StatementMovement[]> {
    const ids = [...invoiceNumbers.keys()];
    if (!ids.length) return [];
    const rows: { id: string; sourceId: string; date: string; refNumber: string; amount: string; createdAt: Date }[] =
      await this.paymentRepo.query(
        `SELECT e.id, e.source_id AS "sourceId", to_char(e.date, 'YYYY-MM-DD') AS date,
                e.ref_number AS "refNumber", e.created_at AS "createdAt",
                (SELECT SUM(l.debit) FROM journal_lines l WHERE l.entry_id = e.id) AS amount
           FROM journal_entries e
          WHERE e.tenant_id = $1 AND e.status = 'posted' AND e.source_type = $2
            AND e.source_id = ANY($3::uuid[]) AND e.date <= $4 AND e.reversed_entry_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversed_entry_id = e.id AND r.status = 'posted')`,
        [tenantId, sourceType, ids, to],
      );
    return rows.map((r) => ({
      date: r.date,
      documentType: 'direct_payment' as const,
      documentId: r.id,
      number: r.refNumber,
      description: `Settlement of ${invoiceNumbers.get(r.sourceId) ?? ''}`.trim(),
      debit: side === 'debit' ? Number(r.amount) : 0,
      credit: side === 'credit' ? Number(r.amount) : 0,
      createdAt: new Date(r.createdAt),
    }));
  }
}
