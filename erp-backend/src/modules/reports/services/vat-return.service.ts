import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesInvoice } from '@modules/sales/entities/sales-invoice.entity';
import { AccountingSettings } from '@modules/accounting/entities/accounting-settings.entity';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { round, today } from '@shared/utils/document-totals.util';
import { SqlParams } from './ledger-sql';

export interface RateBucket {
  rate: number;
  taxableAmount: number;
  vatAmount: number;
}

export interface VatBox {
  box: string;
  labelEn: string;
  labelAr: string;
  amount: number;
  adjustment: number;
  vat: number;
}

const r4 = (n: number) => round(n, 4);

export const STANDARD_RATE = { eg: 14, sa: 15 } as const;

interface VatInput {
  salesByRate: RateBucket[];
  creditNotesByRate: RateBucket[];
  purchasesByRate: RateBucket[];
  refundsByRate: RateBucket[];
}

function pick(buckets: RateBucket[], predicate: (rate: number) => boolean) {
  const sel = buckets.filter((b) => predicate(b.rate));
  return {
    amount: r4(sel.reduce((s, b) => s + b.taxableAmount, 0)),
    vat: r4(sel.reduce((s, b) => s + b.vatAmount, 0)),
  };
}

/**
 * Maps the per-rate totals to the boxes of the return. Credit notes and
 * vendor refunds are reported as (negative) adjustments of the box of their
 * rate. Categories the documents cannot distinguish (exports, exempt supplies,
 * imports, reverse charge) are reported as zero and must be adjusted manually.
 */
export function buildVatBoxes(country: 'eg' | 'sa', input: VatInput): VatBox[] {
  const std = STANDARD_RATE[country];
  const isStd = (r: number) => r === std;
  const isOther = (r: number) => r > 0 && r !== std;
  const isZero = (r: number) => r === 0;
  const box = (
    id: string,
    labelEn: string,
    labelAr: string,
    main: { amount: number; vat: number },
    adj: { amount: number; vat: number } = { amount: 0, vat: 0 },
  ): VatBox => ({
    box: id,
    labelEn,
    labelAr,
    amount: main.amount,
    adjustment: r4(-adj.amount),
    vat: r4(main.vat - adj.vat),
  });
  const zero = { amount: 0, vat: 0 };

  const sStd = pick(input.salesByRate, isStd);
  const cStd = pick(input.creditNotesByRate, isStd);
  const sOther = pick(input.salesByRate, isOther);
  const cOther = pick(input.creditNotesByRate, isOther);
  const sZero = pick(input.salesByRate, isZero);
  const cZero = pick(input.creditNotesByRate, isZero);
  const pStd = pick(input.purchasesByRate, (r) => r > 0);
  const rStd = pick(input.refundsByRate, (r) => r > 0);
  const pZero = pick(input.purchasesByRate, isZero);
  const rZero = pick(input.refundsByRate, isZero);

  const outputVat = r4(sStd.vat - cStd.vat + sOther.vat - cOther.vat);
  const inputVat = r4(pStd.vat - rStd.vat);
  const totalSales = {
    amount: r4(sStd.amount + sOther.amount + sZero.amount),
    vat: r4(sStd.vat + sOther.vat),
  };
  const totalSalesAdj = {
    amount: r4(cStd.amount + cOther.amount + cZero.amount),
    vat: r4(cStd.vat + cOther.vat),
  };
  const totalPurch = { amount: r4(pStd.amount + pZero.amount), vat: pStd.vat };
  const totalPurchAdj = { amount: r4(rStd.amount + rZero.amount), vat: rStd.vat };

  if (country === 'sa') {
    return [
      box('1', 'Standard rated sales', 'المبيعات الخاضعة للنسبة الأساسية', { amount: r4(sStd.amount + sOther.amount), vat: r4(sStd.vat + sOther.vat) }, { amount: r4(cStd.amount + cOther.amount), vat: r4(cStd.vat + cOther.vat) }),
      box('2', 'Sales to citizens (private healthcare / education)', 'المبيعات للمواطنين (الخدمات الصحية الخاصة/التعليم)', zero),
      box('3', 'Zero rated domestic sales', 'المبيعات المحلية الخاضعة للنسبة الصفرية', sZero, cZero),
      box('4', 'Exports', 'الصادرات', zero),
      box('5', 'Exempt sales', 'المبيعات المعفاة', zero),
      box('6', 'Total sales', 'إجمالي المبيعات', totalSales, totalSalesAdj),
      box('7', 'Standard rated domestic purchases', 'المشتريات الخاضعة للنسبة الأساسية', pStd, rStd),
      box('8', 'Imports subject to VAT paid at customs', 'الاستيرادات الخاضعة للضريبة والمدفوعة في الجمارك', zero),
      box('9', 'Imports subject to VAT (reverse charge)', 'الاستيرادات الخاضعة للضريبة بآلية الاحتساب العكسي', zero),
      box('10', 'Zero rated purchases', 'المشتريات الخاضعة للنسبة الصفرية', pZero, rZero),
      box('11', 'Exempt purchases', 'المشتريات المعفاة', zero),
      box('12', 'Total purchases', 'إجمالي المشتريات', totalPurch, totalPurchAdj),
      { box: '13', labelEn: 'Total VAT due for current period', labelAr: 'إجمالي ضريبة القيمة المضافة المستحقة عن الفترة الحالية', amount: 0, adjustment: 0, vat: r4(outputVat - inputVat) },
      { box: '14', labelEn: 'Corrections from previous period', labelAr: 'تصحيحات من الفترات السابقة', amount: 0, adjustment: 0, vat: 0 },
      { box: '15', labelEn: 'VAT credit carried forward', labelAr: 'الرصيد الدائن المرحل من الفترات السابقة', amount: 0, adjustment: 0, vat: 0 },
      { box: '16', labelEn: 'Net VAT due (or reclaimed)', labelAr: 'صافي الضريبة المستحقة (أو المستردة)', amount: 0, adjustment: 0, vat: r4(outputVat - inputVat) },
    ];
  }

  return [
    box('1', `Local taxable sales at the general rate (${std}%)`, `المبيعات المحلية الخاضعة للسعر العام (${std}%)`, sStd, cStd),
    box('2', 'Taxable sales at other rates', 'المبيعات الخاضعة لأسعار أخرى', sOther, cOther),
    box('3', 'Zero-rated and exempt sales', 'المبيعات الخاضعة لسعر صفر والمعفاة', sZero, cZero),
    box('4', 'Total sales', 'إجمالي المبيعات', totalSales, totalSalesAdj),
    { box: '5', labelEn: 'Total output tax', labelAr: 'إجمالي ضريبة المخرجات', amount: 0, adjustment: 0, vat: outputVat },
    box('6', 'Local taxable purchases', 'المشتريات المحلية الخاضعة للضريبة', pStd, rStd),
    box('7', 'Non-taxable and exempt purchases', 'المشتريات غير الخاضعة والمعفاة', pZero, rZero),
    { box: '8', labelEn: 'Total deductible input tax', labelAr: 'إجمالي ضريبة المدخلات القابلة للخصم', amount: 0, adjustment: 0, vat: inputVat },
    { box: '9', labelEn: 'Net tax payable (refundable)', labelAr: 'صافي الضريبة المستحقة (القابلة للرد)', amount: 0, adjustment: 0, vat: r4(outputVat - inputVat) },
  ];
}

/**
 * VAT return (Egyptian monthly VAT return / Saudi ZATCA VAT return) from
 * documents: output VAT from posted sales invoices and POS orders, credit
 * notes as adjustments; input VAT from posted vendor bills, refunds as
 * adjustments. Amounts in base currency. The movement of the output/input
 * VAT accounts in the general ledger is returned for reconciliation.
 */
@Injectable()
export class VatReturnService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async getVatReturn(
    tenantId: string,
    q: { from?: string; to?: string; branchId?: string; country?: 'eg' | 'sa' },
  ) {
    const to = q.to ?? today();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    const country = q.country ?? (await this.tenantCountry(tenantId));

    const sales = await this.byRate('sales', tenantId, from, to, q.branchId);
    const pos = await this.posByRate(tenantId, from, to, q.branchId);
    const purchases = await this.byRate('purchases', tenantId, from, to, q.branchId);

    const salesByRate = merge([...sales.normal, ...pos.normal]);
    const creditNotesByRate = merge([...sales.reversal, ...pos.reversal]);
    const purchasesByRate = purchases.normal;
    const refundsByRate = purchases.reversal;

    const outputVat = r4(sumVat(salesByRate) - sumVat(creditNotesByRate));
    const inputVat = r4(sumVat(purchasesByRate) - sumVat(refundsByRate));

    return {
      country,
      standardRate: STANDARD_RATE[country],
      from,
      to,
      sales: {
        byRate: salesByRate,
        creditNotes: creditNotesByRate,
        netTaxable: r4(sumBase(salesByRate) - sumBase(creditNotesByRate)),
        outputVat,
      },
      purchases: {
        byRate: purchasesByRate,
        refunds: refundsByRate,
        netTaxable: r4(sumBase(purchasesByRate) - sumBase(refundsByRate)),
        inputVat,
      },
      netVatPayable: r4(outputVat - inputVat),
      boxes: buildVatBoxes(country, { salesByRate, creditNotesByRate, purchasesByRate, refundsByRate }),
      ledger: q.branchId ? null : await this.ledgerCheck(tenantId, from, to),
    };
  }

  private async tenantCountry(tenantId: string): Promise<'eg' | 'sa'> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const template = tenant?.settings?.chartTemplate;
    if (template === 'sa' || template === 'eg') return template;
    const c = (tenant?.country ?? '').toUpperCase();
    return c === 'SA' || c === 'KSA' || c.startsWith('SAUDI') ? 'sa' : 'eg';
  }

  private async byRate(
    kind: 'sales' | 'purchases',
    tenantId: string,
    from: string,
    to: string,
    branchId?: string,
  ) {
    const doc = kind === 'sales' ? 'sales_invoices' : 'purchase_invoices';
    const lines = kind === 'sales' ? 'sales_invoice_lines' : 'purchase_invoice_lines';
    const reversalType = kind === 'sales' ? 'credit_note' : 'refund';
    const p = new SqlParams();
    const where = [
      `i.tenant_id = ${p.add(tenantId)}`,
      `i.status NOT IN ('draft', 'cancelled')`,
      `i.date >= ${p.add(from)}`,
      `i.date <= ${p.add(to)}`,
    ];
    if (branchId) where.push(`i.branch_id = ${p.add(branchId)}`);
    const rows: { reversal: boolean; rate: string; base: string }[] = await this.salesInvoiceRepo.query(
      `SELECT (i.move_type = '${reversalType}') AS reversal, l.tax_rate AS rate,
              SUM(l.line_total * i.exchange_rate) AS base
         FROM ${lines} l JOIN ${doc} i ON i.id = l.invoice_id
        WHERE ${where.join(' AND ')}
        GROUP BY 1, 2`,
      p.values,
    );
    return split(rows.map((r) => ({ reversal: !!r.reversal, rate: Number(r.rate), base: Number(r.base) })));
  }

  /**
   * POS refunds are orders with negative lines; they are reported as credit
   * notes. POS line totals include VAT, so the taxable base is recomputed as
   * quantity × unit price − discount.
   */
  private async posByRate(tenantId: string, from: string, to: string, branchId?: string) {
    const p = new SqlParams();
    const where = [
      `o.tenant_id = ${p.add(tenantId)}`,
      `o.status IN ('completed', 'refunded')`,
      `o.created_at::date >= ${p.add(from)}`,
      `o.created_at::date <= ${p.add(to)}`,
    ];
    if (branchId) where.push(`t.branch_id = ${p.add(branchId)}`);
    const rows: { reversal: boolean; rate: string; base: string }[] = await this.salesInvoiceRepo.query(
      `SELECT (o.refunded_order_id IS NOT NULL) AS reversal, l.tax_rate AS rate, SUM(ABS(l.quantity * l.unit_price - l.discount)) AS base
         FROM pos_order_lines l
         JOIN pos_orders o ON o.id = l.order_id
         LEFT JOIN pos_sessions s ON s.id = o.session_id
         LEFT JOIN pos_terminals t ON t.id = s.terminal_id
        WHERE ${where.join(' AND ')}
        GROUP BY 1, 2`,
      p.values,
    );
    return split(rows.map((r) => ({ reversal: !!r.reversal, rate: Number(r.rate), base: Number(r.base) })));
  }

  private async ledgerCheck(tenantId: string, from: string, to: string) {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!settings?.outputTaxAccountId && !settings?.inputTaxAccountId) return null;
    const rows: { accountId: string; debit: string; credit: string }[] = await this.salesInvoiceRepo.query(
      `SELECT l.account_id AS "accountId", SUM(l.debit) AS debit, SUM(l.credit) AS credit
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.tenant_id = $1 AND e.status = 'posted' AND e.date >= $2 AND e.date <= $3
          AND l.account_id = ANY($4::uuid[])
        GROUP BY l.account_id`,
      [tenantId, from, to, [settings.outputTaxAccountId, settings.inputTaxAccountId].filter(Boolean)],
    );
    const net = (id?: string) => {
      const r = rows.find((x) => x.accountId === id);
      return r ? Number(r.debit) - Number(r.credit) : 0;
    };
    const outputVat = r4(-net(settings.outputTaxAccountId));
    const inputVat = r4(net(settings.inputTaxAccountId));
    return { outputVat, inputVat, netVatPayable: r4(outputVat - inputVat) };
  }
}

function split(rows: { reversal: boolean; rate: number; base: number }[]) {
  const toBucket = (r: { rate: number; base: number }): RateBucket => ({
    rate: r.rate,
    taxableAmount: r4(r.base),
    vatAmount: r4((r.base * r.rate) / 100),
  });
  return {
    normal: merge(rows.filter((r) => !r.reversal).map(toBucket)),
    reversal: merge(rows.filter((r) => r.reversal).map(toBucket)),
  };
}

function merge(buckets: RateBucket[]): RateBucket[] {
  const byRate = new Map<number, RateBucket>();
  for (const b of buckets) {
    const cur = byRate.get(b.rate) ?? { rate: b.rate, taxableAmount: 0, vatAmount: 0 };
    cur.taxableAmount = r4(cur.taxableAmount + b.taxableAmount);
    cur.vatAmount = r4(cur.vatAmount + b.vatAmount);
    byRate.set(b.rate, cur);
  }
  return [...byRate.values()].sort((a, b) => b.rate - a.rate);
}

const sumVat = (b: RateBucket[]) => b.reduce((s, x) => s + x.vatAmount, 0);
const sumBase = (b: RateBucket[]) => b.reduce((s, x) => s + x.taxableAmount, 0);
