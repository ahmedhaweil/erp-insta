import { amountInWords } from '../engine/number-to-words';
import { Field, PrintDocument, TableBlock } from '../templates/document.model';
import { money, percent } from '../templates/format';
import { labels, LabelKey, valueLabel } from '../templates/labels';
import { col, compact, lineTax, otherLang, partyBlock, round4 } from './common';
import { LineView, OrderView, PrintContext, TaxDocumentView } from './views';

interface ComputedRow {
  index: number;
  item: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  net: number;
  taxRate: number;
  tax: number;
  total: number;
  ordered?: number;
  delivered?: number;
  remaining?: number;
}

/** Recomputes the printable amounts of each line (net, VAT, gross). */
export function computeRows(lines: LineView[], pricesIncludeTax = false): ComputedRow[] {
  return lines.map((l, i) => {
    const net = round4(Number(l.lineTotal));
    const gross = pricesIncludeTax ? round4(Number(l.quantity) * Number(l.unitPrice) - Number(l.discount || 0)) : undefined;
    const tax = lineTax(net, Number(l.taxRate || 0), gross);
    const name = [l.productCode ? `[${l.productCode}]` : '', l.productName].filter(Boolean).join(' ');
    const item = l.description && l.description !== l.productName ? `${name}\n${l.description}` : name;
    const ordered = l.ordered === undefined ? undefined : Number(l.ordered);
    const delivered = l.delivered === undefined ? undefined : Number(l.delivered);
    return {
      index: i + 1,
      item,
      unit: l.unit ?? '',
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discount: Number(l.discount || 0),
      net,
      taxRate: Number(l.taxRate || 0),
      tax,
      total: round4(net + tax),
      ordered,
      delivered,
      remaining: ordered !== undefined && delivered !== undefined ? round4(ordered - delivered) : undefined,
    };
  });
}

/** VAT breakdown per rate: [{rate, taxable, tax}]. */
export function vatBreakdown(rows: { taxRate: number; net: number; tax: number }[]) {
  const map = new Map<number, { rate: number; taxable: number; tax: number }>();
  for (const r of rows) {
    const e = map.get(r.taxRate) ?? { rate: r.taxRate, taxable: 0, tax: 0 };
    e.taxable = round4(e.taxable + r.net);
    e.tax = round4(e.tax + r.tax);
    map.set(r.taxRate, e);
  }
  return [...map.values()].sort((a, b) => b.rate - a.rate);
}

function linesTable(rows: ComputedRow[], ctx: PrintContext, withPrices: boolean): TableBlock {
  const t = labels(ctx.lang);
  const narrow = ctx.paper === '80mm';
  const hasDiscount = rows.some((r) => r.discount > 0);
  const columns = withPrices
    ? [
        col('index', t('index'), 3, 'index', 'center'),
        col('item', t('item'), 26),
        col('unit', t('unit'), 6, 'text', 'center'),
        col('quantity', t('quantity'), 7, 'qty'),
        col('unitPrice', t('unitPrice'), 10, 'money'),
        ...(hasDiscount ? [col('discount', t('discount'), 8, 'money')] : []),
        col('net', t('lineNet'), 11, 'money'),
        col('taxRateText', t('taxRate'), 6, 'text', 'center'),
        col('tax', t('taxAmount'), 9, 'money'),
        col('total', t('lineTotal'), 11, 'money'),
      ]
    : [
        col('index', t('index'), 3, 'index', 'center'),
        col('item', t('item'), 34),
        col('unit', t('unit'), 7, 'text', 'center'),
        col('quantity', t('quantity'), 8, 'qty'),
      ];
  return {
    columns,
    rows: rows.map((r) => ({ ...r, taxRateText: percent(r.taxRate) })),
    compact: narrow
      ? withPrices
        ? { title: 'item', detail: ['quantity', 'unitPrice'], amount: 'total' }
        : { title: 'item', detail: ['quantity', 'unit'] }
      : undefined,
  };
}

function totalsFields(
  ctx: PrintContext,
  rows: ComputedRow[],
  doc: { subtotal: number; taxAmount: number; totalAmount: number },
): Field[] {
  const t = labels(ctx.lang);
  const cur = ctx.currencyCode;
  const fields: Field[] = [{ label: t('subtotal'), value: money(doc.subtotal) }];
  const discount = rows.reduce((s, r) => s + r.discount, 0);
  if (discount > 0) fields.push({ label: t('totalDiscount'), value: money(discount) });
  const vat = vatBreakdown(rows).filter((v) => v.rate > 0);
  if (vat.length > 1) {
    for (const v of vat) fields.push({ label: `${t('vatAt')} ${percent(v.rate)}`, value: money(v.tax) });
  }
  fields.push({
    label: vat.length === 1 ? `${t('vatAt')} ${percent(vat[0].rate)}` : t('totalVat'),
    value: money(doc.taxAmount),
  });
  fields.push({ label: `${t('total')} (${cur})`, value: money(doc.totalAmount), bold: true });
  return fields;
}

/** Sales tax invoice / credit note (Egyptian & Saudi tax invoice content). */
export function buildTaxDocument(v: TaxDocumentView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const credit = v.kind === 'credit_note';
  const simplified = !!v.saudi && !credit && !v.buyer.taxId;
  const titleKey: LabelKey = credit ? 'creditNote' : simplified ? 'simplifiedTaxInvoice' : 'taxInvoice';
  const rows = computeRows(v.lines, v.pricesIncludeTax);
  const vatLabel: LabelKey = v.saudi ? 'vatNumber' : 'taxNumber';

  const totals = totalsFields(ctx, rows, v);
  // The grand total is the last row; extra informative rows follow it.
  const grand = totals.pop()!;
  if (Number(v.installmentInterest) > 0) {
    totals.push({ label: ctx.lang === 'ar' ? 'فوائد التقسيط' : 'Installment interest', value: money(v.installmentInterest) });
  }
  totals.push(grand);
  if (!credit && Number(v.withholdingAmount) > 0) {
    totals.push({ label: t('withholding'), value: money(v.withholdingAmount), bold: false });
  }
  if (!credit && Number(v.paidAmount) > 0) {
    totals.push({ label: t('paid'), value: money(v.paidAmount), bold: false });
    totals.push({
      label: t('due'),
      value: money(Math.max(round4(Number(v.totalAmount) - Number(v.paidAmount)), 0)),
      bold: false,
    });
  }

  const qrContent = v.zatcaQr || v.eta?.url || null;
  const issued = v.issuedAt ? new Date(v.issuedAt as string) : null;
  return {
    lang: ctx.lang,
    paper: ctx.paper,
    title: t(titleKey),
    subtitle: otherLang(titleKey, ctx.lang),
    number: v.number,
    company: { ...ctx.company, branch: v.branchName ?? ctx.company.branch },
    meta: compact([
      { label: t('number'), value: v.number },
      { label: t('issueDate'), value: v.date },
      {
        label: ctx.lang === 'ar' ? 'وقت الإصدار' : 'Issue time',
        value: issued && !Number.isNaN(issued.getTime()) ? issued.toISOString().slice(11, 16) : null,
      },
      { label: t('dueDate'), value: credit ? null : v.dueDate },
      { label: t('originalInvoice'), value: v.originalNumber },
      { label: t('orderNumber'), value: v.orderNumber },
      { label: t('currency'), value: ctx.currencyCode },
      { label: t('exchangeRate'), value: v.exchangeRate && Number(v.exchangeRate) !== 1 ? Number(v.exchangeRate) : null },
      { label: t('status'), value: valueLabel(v.status, ctx.lang) },
    ]),
    parties: [
      partyBlock(t('seller'), v.seller, ctx.lang, vatLabel),
      partyBlock(t('buyer'), v.buyer, ctx.lang, vatLabel),
    ],
    tables: [linesTable(rows, ctx, true)],
    totals,
    amountInWords: amountInWords(Number(v.totalAmount), ctx.currencyCode, ctx.lang),
    qr: qrContent ? { content: qrContent, caption: v.zatcaQr ? t('zatcaQr') : t('etaQr') } : undefined,
    references: compact([
      { label: t('etaUuid'), value: v.eta?.uuid },
      { label: t('etaStatus'), value: v.eta?.status ? valueLabel(v.eta.status, ctx.lang) : null },
      { label: t('etaUrl'), value: v.eta?.url },
      { label: t('zatcaUuid'), value: v.zatcaUuid },
    ]),
    notes: [v.notes ?? ''],
    signatures: ctx.paper === '80mm' ? [] : [t('preparedBy'), t('accountant'), t('customerSign')],
    filename: `${credit ? 'credit-note' : 'invoice'}-${v.number}`,
  };
}

const ORDER_TITLES: Record<OrderView['kind'], LabelKey> = {
  quotation: 'quotation',
  sales_order: 'salesOrder',
  purchase_order: 'purchaseOrder',
  rfq: 'rfq',
  delivery_note: 'deliveryNote',
};

/** Quotation, sales order, purchase order / RFQ and delivery note (no prices). */
export function buildOrderDocument(v: OrderView, ctx: PrintContext): PrintDocument {
  const t = labels(ctx.lang);
  const titleKey = ORDER_TITLES[v.kind];
  const purchase = v.kind === 'purchase_order' || v.kind === 'rfq';
  const delivery = v.kind === 'delivery_note';
  const rows = computeRows(v.lines, v.pricesIncludeTax);
  const secondaryLabel: LabelKey =
    v.kind === 'quotation' ? 'validUntil' : purchase ? 'expectedDate' : delivery ? 'date' : 'dueDate';

  let table: TableBlock;
  if (delivery) {
    table = {
      columns: [
        col('index', t('index'), 3, 'index', 'center'),
        col('item', t('item'), 30),
        col('unit', t('unit'), 7, 'text', 'center'),
        col('ordered', t('ordered'), 8, 'qty'),
        col('quantity', t('delivered'), 8, 'qty'),
        col('remaining', t('remaining'), 8, 'qty'),
      ],
      rows: rows.map((r) => ({ ...r, remaining: r.remaining ?? '' })),
      compact: ctx.paper === '80mm' ? { title: 'item', detail: ['quantity', 'unit'] } : undefined,
    };
  } else {
    table = linesTable(rows, ctx, true);
  }

  return {
    lang: ctx.lang,
    paper: ctx.paper,
    title: t(titleKey),
    subtitle: otherLang(titleKey, ctx.lang),
    number: v.number,
    company: { ...ctx.company, branch: v.branchName ?? ctx.company.branch },
    meta: compact([
      { label: t('number'), value: v.number },
      { label: t('date'), value: v.date },
      { label: t(secondaryLabel), value: delivery ? null : v.secondaryDate },
      { label: t('orderNumber'), value: v.reference },
      { label: t('warehouse'), value: v.warehouseName },
      { label: t('currency'), value: delivery ? null : ctx.currencyCode },
      { label: t('status'), value: valueLabel(v.status, ctx.lang) },
    ]),
    parties: [partyBlock(purchase ? t('supplier') : t('customer'), v.partner, ctx.lang)],
    tables: [table],
    totals: delivery ? undefined : totalsFields(ctx, rows, v),
    amountInWords: delivery ? undefined : amountInWords(Number(v.totalAmount), ctx.currencyCode, ctx.lang),
    notes: [v.notes ?? ''],
    signatures: delivery
      ? [t('storekeeper'), t('receivedBy')]
      : purchase
        ? [t('preparedBy'), t('approvedBy')]
        : [t('preparedBy'), t('approvedBy'), t('customerSign')],
    filename: `${v.kind.replace('_', '-')}-${v.number}`,
  };
}
