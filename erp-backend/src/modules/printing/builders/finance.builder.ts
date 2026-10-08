import { amountInWords } from '../engine/number-to-words';
import { PrintDocument, TableBlock } from '../templates/document.model';
import { money } from '../templates/format';
import { labels, LabelKey, valueLabel } from '../templates/labels';
import { col, compact, otherLang } from './common';
import { PrintContext, StatementView, VoucherView } from './views';

/** Receipt voucher (سند قبض) / payment voucher (سند صرف), treasury or customer/supplier payment. */
export function buildVoucher(v: VoucherView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const titleKey: LabelKey = v.kind === 'receipt' ? 'receiptVoucher' : 'paymentVoucher';
  const partyTitle =
    v.counterpartyType === 'customer'
      ? t('customer')
      : v.counterpartyType === 'supplier'
        ? t('supplier')
        : v.kind === 'receipt'
          ? t('receivedFrom')
          : t('paidTo');

  const tables: TableBlock[] = [];
  if (v.lines.length) {
    tables.push({
      columns: [
        col('index', t('index'), 3, 'index', 'center'),
        col('account', t('account'), 22),
        col('description', t('description'), 26),
        col('amount', t('amount'), 10, 'money'),
      ],
      rows: v.lines.map((l) => ({ ...l })),
      footer: v.lines.length > 1 ? { description: t('grandTotal'), amount: v.amount } : undefined,
      compact: ctx.paper === '80mm' ? { title: 'account', detail: ['description'], amount: 'amount' } : undefined,
    });
  }
  if (v.allocations?.length) {
    tables.push({
      title: ctx.lang === 'ar' ? 'الفواتير المسددة' : 'Invoices settled',
      columns: [
        col('index', t('index'), 3, 'index', 'center'),
        col('number', t('document'), 30),
        col('amount', t('amount'), 12, 'money'),
      ],
      rows: v.allocations.map((a) => ({ ...a })),
      compact: ctx.paper === '80mm' ? { title: 'number', amount: 'amount' } : undefined,
    });
  }

  const totals = [{ label: `${t('amount')} (${ctx.currencyCode})`, value: money(v.amount), bold: true }];
  if (Number(v.withholdingAmount) > 0) {
    totals.unshift({ label: t('withholding'), value: money(v.withholdingAmount), bold: false });
  }

  return {
    lang: ctx.lang,
    paper: ctx.paper,
    title: t(titleKey),
    subtitle: otherLang(titleKey, ctx.lang),
    number: v.number,
    company: ctx.company,
    meta: compact([
      { label: t('number'), value: v.number },
      { label: t('date'), value: v.date },
      { label: t('method'), value: valueLabel(v.method, ctx.lang) },
      { label: t('treasury'), value: v.treasuryName },
      { label: t('reference'), value: v.reference },
      { label: t('currency'), value: ctx.currencyCode },
      { label: t('status'), value: valueLabel(v.status, ctx.lang) },
    ]),
    parties: [
      {
        title: partyTitle,
        fields: compact([
          { label: t('name'), value: v.counterparty.name, bold: true },
          { label: t('code'), value: v.counterparty.code },
          { label: t('taxNumber'), value: v.counterparty.taxId },
          { label: t('phone'), value: v.counterparty.phone },
          { label: t('description'), value: v.description },
          ...(v.cheque
            ? [
                { label: ctx.lang === 'ar' ? 'رقم الشيك' : 'Cheque no.', value: v.cheque.number },
                { label: t('bank'), value: v.cheque.bank },
                { label: t('dueDate'), value: v.cheque.dueDate },
              ]
            : []),
        ]),
      },
    ],
    tables,
    totals,
    amountInWords: amountInWords(Number(v.amount), ctx.currencyCode, ctx.lang),
    signatures:
      ctx.paper === '80mm'
        ? []
        : [t('accountant'), t('cashierSign'), v.kind === 'receipt' ? t('preparedBy') : t('receivedBy')],
    filename: `${v.kind}-voucher-${v.number}`,
  };
}

/** Customer / supplier statement of account (from the reports partner statement). */
export function buildStatement(v: StatementView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const rows = v.lines.map((l) => ({
    ...l,
    description: statementDescription(l.description, ctx.lang),
    type: valueLabel(l.documentType, ctx.lang),
    doc: [l.number, l.reference].filter(Boolean).join(' / '),
  }));
  const balanceLabel = (n: number) => {
    // Customers: positive = they owe us (debit). Suppliers: positive = we owe them (credit).
    const nature = v.partnerType === 'customer' ? (n >= 0 ? t('debit') : t('credit')) : n >= 0 ? t('credit') : t('debit');
    return `${money(Math.abs(n))} ${nature}`;
  };
  return {
    lang: ctx.lang,
    paper: ctx.paper === '80mm' ? 'a4' : ctx.paper,
    title: t('statement'),
    subtitle: otherLang('statement', ctx.lang),
    number: v.partner.code ?? undefined,
    company: ctx.company,
    meta: compact([
      { label: t('from'), value: v.from ?? '—' },
      { label: t('to'), value: v.to },
      { label: t('currency'), value: ctx.currencyCode },
      { label: t('openingBalance'), value: balanceLabel(v.openingBalance) },
    ]),
    parties: [
      {
        title: v.partnerType === 'customer' ? t('customer') : t('supplier'),
        fields: compact([
          { label: t('name'), value: v.partner.name, bold: true },
          { label: t('code'), value: v.partner.code },
          { label: t('taxNumber'), value: v.partner.taxId },
          { label: t('phone'), value: v.partner.phone },
          { label: t('address'), value: v.partner.address },
        ]),
      },
    ],
    tables: [
      {
        columns: [
          col('date', t('date'), 9, 'text', 'center'),
          col('type', t('document'), 10),
          col('doc', t('number'), 13),
          col('description', t('description'), 22),
          col('debit', t('debit'), 10, 'money'),
          col('credit', t('credit'), 10, 'money'),
          col('balance', t('balance'), 11, 'money'),
        ],
        rows: [
          { date: v.from ?? '', description: t('openingBalance'), balance: v.openingBalance },
          ...rows,
        ],
        footer: { description: t('grandTotal'), debit: v.totalDebit, credit: v.totalCredit, balance: v.closingBalance },
      },
    ],
    totals: [
      { label: t('openingBalance'), value: balanceLabel(v.openingBalance) },
      { label: t('totalDebit'), value: money(v.totalDebit) },
      { label: t('totalCredit'), value: money(v.totalCredit) },
      { label: t('closingBalance'), value: balanceLabel(v.closingBalance), bold: true },
    ],
    amountInWords: amountInWords(Math.abs(v.closingBalance), ctx.currencyCode, ctx.lang),
    signatures: [t('accountant'), t('approvedBy')],
    filename: `statement-${v.partner.code ?? 'partner'}`,
  };
}

const AR_PHRASES: [RegExp, string][] = [
  [/^Sales invoice$/, 'فاتورة مبيعات'],
  [/^Credit note$/, 'إشعار دائن'],
  [/^Vendor bill$/, 'فاتورة مورد'],
  [/^Vendor refund$/, 'مرتجع مورد'],
  [/^Settlement of\b/, 'تسوية'],
  [/^Payment\b/, 'سداد'],
  [/^Refund\b/, 'رد مبلغ'],
  [/\(cash\)/, '(نقدي)'],
  [/\(bank\)/, '(تحويل بنكي)'],
  [/\(card\)/, '(بطاقة)'],
  [/\(cheque\)/, '(شيك)'],
];

/** Arabic wording of the (English) partner statement descriptions. */
export function statementDescription(description: string, lang: 'ar' | 'en'): string {
  if (lang !== 'ar' || !description) return description;
  return AR_PHRASES.reduce((s, [re, ar]) => s.replace(re, ar), description);
}
