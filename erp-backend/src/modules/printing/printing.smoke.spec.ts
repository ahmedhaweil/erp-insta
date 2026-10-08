import * as F from './printing.fixtures';
import { buildOrderDocument, buildTaxDocument, computeRows, vatBreakdown } from './builders/commercial.builder';
import { buildStatement, buildVoucher, statementDescription } from './builders/finance.builder';
import { buildPayrollRegister, buildPayslip, buildPosReceipt } from './builders/pos-payroll.builder';
import { renderDocument } from './templates/render';
import { renderA4Batch } from './templates/a4-renderer';
import { DEFAULT_CHEQUE_LAYOUT, formatChequeDate, renderCheque } from './templates/cheque-renderer';
import { PrintDocument } from './templates/document.model';
import { ReportExportService } from '@modules/reports/export/report-export.service';
import { PdfFile } from './pdf-file';
import { decodeTlv } from '@modules/compliance/zatca/zatca-tlv';

const isPdf = (buf: Buffer) => {
  expect(buf.length).toBeGreaterThan(1500);
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(buf.subarray(-6).toString()).toContain('%%EOF');
};

/** Number of pages in a PDFKit document (uncompressed page tree count). */
const pageCount = (buf: Buffer) => Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(buf.toString('latin1'))?.[1] ?? 0);

jest.setTimeout(30000);

describe('printing smoke tests', () => {
  const documents: [string, () => PrintDocument][] = [
    ['tax invoice ar (ETA)', () => buildTaxDocument(F.sampleInvoice(), F.sampleContext('ar'))],
    ['tax invoice en', () => buildTaxDocument(F.sampleInvoice(), F.sampleContext('en'))],
    ['simplified invoice 80mm (ZATCA)', () => buildTaxDocument(F.sampleInvoice(true), F.sampleContext('ar', '80mm', 'SAR'))],
    ['credit note', () => buildTaxDocument({ ...F.sampleInvoice(), kind: 'credit_note', originalNumber: 'INV-1' }, F.sampleContext('ar'))],
    ['quotation', () => buildOrderDocument(F.sampleOrder('quotation'), F.sampleContext('ar'))],
    ['sales order en', () => buildOrderDocument(F.sampleOrder('sales_order'), F.sampleContext('en'))],
    ['delivery note', () => buildOrderDocument(F.sampleOrder('delivery_note'), F.sampleContext('ar'))],
    ['delivery note 80mm', () => buildOrderDocument(F.sampleOrder('delivery_note'), F.sampleContext('en', '80mm'))],
    ['purchase order', () => buildOrderDocument(F.sampleOrder('purchase_order'), F.sampleContext('en'))],
    ['receipt voucher', () => buildVoucher(F.sampleVoucher('receipt'), F.sampleContext('ar'))],
    ['payment voucher 80mm', () => buildVoucher(F.sampleVoucher('payment'), F.sampleContext('ar', '80mm'))],
    ['POS receipt', () => buildPosReceipt(F.samplePos(), F.sampleContext('ar', '80mm', 'SAR'))],
    ['POS receipt A4 en', () => buildPosReceipt(F.samplePos(), F.sampleContext('en', 'a4', 'SAR'))],
    ['payslip', () => buildPayslip(F.samplePayslip(), F.sampleContext('ar'))],
    ['payroll register', () => buildPayrollRegister(F.sampleRegister(), F.sampleContext('en'))],
    ['statement', () => buildStatement(F.sampleStatement(), F.sampleContext('ar'))],
  ];

  it.each(documents)('renders a non-empty PDF: %s', async (_name, build) => {
    isPdf(await renderDocument(build(), new Date('2026-10-08T10:00:00Z')));
  });

  it('breaks long tables over several pages', async () => {
    const order = F.sampleOrder('sales_order');
    order.lines = Array.from({ length: 120 }, (_, i) => ({ ...order.lines[i % 3], productCode: `P-${i}` }));
    const buf = await renderDocument(buildOrderDocument(order, F.sampleContext('ar')));
    isPdf(buf);
    expect(pageCount(buf)).toBeGreaterThan(2);
  });

  it('renders several documents in one PDF (payslips of a run)', async () => {
    const doc = buildPayslip(F.samplePayslip(), F.sampleContext('ar'));
    const buf = await renderA4Batch([doc, doc, doc]);
    isPdf(buf);
    expect(pageCount(buf)).toBe(3);
  });

  it('prints a cheque on the default layout', async () => {
    isPdf(
      await renderCheque(DEFAULT_CHEQUE_LAYOUT, {
        date: '2026-10-08',
        payee: 'مؤسسة الأمل للمقاولات',
        amount: '12,500.75',
        amountWords: 'فقط اثنا عشر ألفاً وخمسمائة جنيه مصري وخمسة وسبعون قرشاً لا غير',
      }),
    );
    expect(formatChequeDate('2026-10-08', 'DD/MM/YYYY')).toBe('08/10/2026');
  });

  it('renders report exports as PDF (reports ?format=pdf)', async () => {
    const svc = new ReportExportService();
    const spec = {
      title: { en: 'Trial balance', ar: 'ميزان المراجعة' },
      filename: 'trial-balance',
      meta: [{ label: { en: 'To', ar: 'إلى' }, value: '2026-10-31' }],
      sheets: [
        {
          name: { en: 'Trial balance', ar: 'ميزان المراجعة' },
          columns: [
            { key: 'code', label: { en: 'Code', ar: 'الكود' } },
            { key: 'name', label: { en: 'Account', ar: 'الحساب' } },
            { key: 'debit', label: { en: 'Debit', ar: 'مدين' }, type: 'money' as const },
          ],
          rows: [{ code: '1101', name: 'الخزينة', debit: 1500 }],
          totals: { name: 'الإجمالي', debit: 1500 },
        },
      ],
    };
    const file = await svc.respond('pdf', 'ar', {}, () => spec);
    expect(file).toBeInstanceOf(PdfFile);
    expect((file as PdfFile).getHeaders().type).toBe('application/pdf');
    expect(await svc.respond('json', 'ar', { a: 1 }, () => spec)).toEqual({ a: 1 });
  });
});

describe('document builders', () => {
  it('computes VAT per rate and prints the totals in words', () => {
    const doc = buildTaxDocument(F.sampleInvoice(), F.sampleContext('ar'));
    expect(doc.title).toBe('فاتورة ضريبية');
    expect(doc.subtitle).toBe('Tax invoice');
    expect(doc.amountInWords).toContain('جنيهاً مصرياً');
    expect(doc.totals!.map((t) => t.label)).toEqual(
      expect.arrayContaining(['الإجمالي قبل الضريبة', 'ضريبة القيمة المضافة 14%']),
    );
    const rows = computeRows(F.sampleInvoice().lines);
    expect(vatBreakdown(rows)).toEqual([
      { rate: 14, taxable: 51252.5, tax: 7175.35 },
      { rate: 0, taxable: 1000, tax: 0 },
    ]);
  });

  it('prints the ETA print URL as QR and its UUID in the references', () => {
    const doc = buildTaxDocument(F.sampleInvoice(), F.sampleContext('en'));
    expect(doc.qr?.content).toContain('invoicing.eta.gov.eg');
    expect(doc.references!.map((r) => r.value)).toContain('R0SXXTV7DVVWGJ4XC6TP6N0J10');
  });

  it('prints a ZATCA simplified invoice with the TLV QR when the buyer has no VAT number', () => {
    const view = F.sampleInvoice(true);
    view.buyer = { name: 'عميل نقدي' };
    const doc = buildTaxDocument(view, F.sampleContext('ar', '80mm', 'SAR'));
    expect(doc.title).toBe('فاتورة ضريبية مبسطة');
    const tags = decodeTlv(doc.qr!.content);
    expect(tags.map((t) => t.tag)).toEqual([1, 2, 3, 4, 5]);
    expect(tags[1].value.toString()).toBe('300000000000003');
  });

  it('handles tax-inclusive prices', () => {
    const [row] = computeRows(
      [{ productName: 'x', quantity: 1, unitPrice: 115, discount: 0, taxRate: 15, lineTotal: 100 }],
      true,
    );
    expect(row).toMatchObject({ net: 100, tax: 15, total: 115 });
  });

  it('delivery notes carry no prices', () => {
    const doc = buildOrderDocument(F.sampleOrder('delivery_note'), F.sampleContext('ar'));
    expect(doc.totals).toBeUndefined();
    expect(doc.amountInWords).toBeUndefined();
    expect(doc.tables![0].columns.map((c) => c.key)).not.toContain('unitPrice');
  });

  it('localises statement descriptions in Arabic', () => {
    expect(statementDescription('Payment (cheque) - INV-1', 'ar')).toBe('سداد (شيك) - INV-1');
    expect(statementDescription('Sales invoice', 'en')).toBe('Sales invoice');
  });

  it('payroll register totals every column', () => {
    const doc = buildPayrollRegister(F.sampleRegister(), F.sampleContext('ar'));
    expect(doc.paper).toBe('a4-landscape');
    expect(doc.tables![0].footer!.net).toBeCloseTo(17031.86, 2);
  });
});
