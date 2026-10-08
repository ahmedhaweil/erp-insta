import { NotFoundException } from '@nestjs/common';
import { PartnerStatementService, buildStatement } from './partner-statement.service';
import { buildVatBoxes } from './vat-return.service';
import { SalesAnalysisService, aggregate, SalesFact } from './sales-analysis.service';
import { ReportExportService, ExcelFile } from '../export/report-export.service';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { of, lastValueFrom } from 'rxjs';

describe('buildStatement', () => {
  const m = (date: string, number: string, debit: number, credit: number) => ({
    date,
    number,
    documentType: 'invoice' as const,
    documentId: number,
    description: '',
    debit,
    credit,
  });

  it('sums earlier movements into the opening balance and runs the customer balance', () => {
    const s = buildStatement(
      [m('2026-03-05', 'INV-2', 200, 0), m('2026-02-01', 'INV-1', 100, 0), m('2026-03-10', 'PAY-1', 0, 50)],
      '2026-03-01',
      1,
    );
    expect(s.openingBalance).toBe(100);
    expect(s.lines.map((l) => [l.number, l.balance])).toEqual([
      ['INV-2', 300],
      ['PAY-1', 250],
    ]);
    expect(s.totalDebit).toBe(200);
    expect(s.totalCredit).toBe(50);
    expect(s.closingBalance).toBe(250);
  });

  it('uses the credit nature for suppliers', () => {
    const s = buildStatement([m('2026-01-01', 'BILL-1', 0, 500), m('2026-01-02', 'PAY-1', 200, 0)], undefined, -1);
    expect(s.lines.map((l) => l.balance)).toEqual([500, 300]);
    expect(s.closingBalance).toBe(300);
  });
});

describe('PartnerStatementService', () => {
  const repo = (rows: any[] = []) => ({ find: jest.fn().mockResolvedValue(rows), query: jest.fn().mockResolvedValue([]) });

  it('lists invoices, credit notes, payments and refunds for a customer', async () => {
    const invoices = repo([
      { id: 'i1', invoiceNumber: 'INV-1', date: '2026-01-10', dueDate: '2026-02-10', moveType: 'invoice', totalAmount: '114' },
      { id: 'c1', invoiceNumber: 'RINV-1', date: '2026-01-12', moveType: 'credit_note', totalAmount: '14' },
    ]);
    const payments = repo([
      { id: 'p1', paymentNumber: 'PAY-IN-1', date: '2026-01-15', direction: 'inbound', amount: '60', method: 'cash' },
      { id: 'p2', paymentNumber: 'PAY-OUT-1', date: '2026-01-20', direction: 'outbound', amount: '10', method: 'bank' },
    ]);
    payments.query.mockResolvedValue([
      { id: 'je', sourceId: 'i1', date: '2026-01-25', refNumber: 'JE-9', amount: '5', createdAt: new Date() },
    ]);
    const allocations = repo([{ paymentId: 'p1', invoiceId: 'i1' }]);
    const customers = { findOne: jest.fn().mockResolvedValue({ id: 'cu', code: 'C1', balance: '35' }) };
    const service = new PartnerStatementService(
      invoices as any,
      repo() as any,
      payments as any,
      allocations as any,
      customers as any,
      { findOne: jest.fn() } as any,
    );

    const st = await service.getStatement('t1', { partnerType: 'customer', partnerId: 'cu', to: '2026-12-31' });
    expect(st.lines.map((l) => [l.documentType, l.debit, l.credit, l.balance])).toEqual([
      ['invoice', 114, 0, 114],
      ['credit_note', 0, 14, 100],
      ['payment', 0, 60, 40],
      ['refund', 10, 0, 50],
      ['direct_payment', 0, 5, 45],
    ]);
    expect(st.lines[2].description).toContain('INV-1');
    expect(st.closingBalance).toBe(45);
  });

  it('fails for an unknown partner', async () => {
    const none = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new PartnerStatementService({} as any, {} as any, {} as any, {} as any, none as any, none as any);
    await expect(
      service.getStatement('t1', { partnerType: 'supplier', partnerId: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('buildVatBoxes', () => {
  const input = {
    salesByRate: [
      { rate: 14, taxableAmount: 1000, vatAmount: 140 },
      { rate: 5, taxableAmount: 100, vatAmount: 5 },
      { rate: 0, taxableAmount: 50, vatAmount: 0 },
    ],
    creditNotesByRate: [{ rate: 14, taxableAmount: 200, vatAmount: 28 }],
    purchasesByRate: [{ rate: 14, taxableAmount: 500, vatAmount: 70 }],
    refundsByRate: [{ rate: 14, taxableAmount: 100, vatAmount: 14 }],
  };

  it('maps Egyptian return boxes with credit notes as adjustments', () => {
    const boxes = new Map(buildVatBoxes('eg', input).map((b) => [b.box, b]));
    expect(boxes.get('1')).toMatchObject({ amount: 1000, adjustment: -200, vat: 112 });
    expect(boxes.get('2')).toMatchObject({ amount: 100, vat: 5 });
    expect(boxes.get('3')).toMatchObject({ amount: 50, vat: 0 });
    expect(boxes.get('5')!.vat).toBe(117);
    expect(boxes.get('8')!.vat).toBe(56);
    expect(boxes.get('9')!.vat).toBe(61);
  });

  it('maps the Saudi ZATCA return boxes', () => {
    const sa = {
      ...input,
      salesByRate: [{ rate: 15, taxableAmount: 1000, vatAmount: 150 }, { rate: 0, taxableAmount: 40, vatAmount: 0 }],
      creditNotesByRate: [{ rate: 15, taxableAmount: 100, vatAmount: 15 }],
      purchasesByRate: [{ rate: 15, taxableAmount: 400, vatAmount: 60 }],
      refundsByRate: [],
    };
    const boxes = new Map(buildVatBoxes('sa', sa).map((b) => [b.box, b]));
    expect(boxes.get('1')).toMatchObject({ amount: 1000, adjustment: -100, vat: 135 });
    expect(boxes.get('3')).toMatchObject({ amount: 40 });
    expect(boxes.get('6')).toMatchObject({ amount: 1040, adjustment: -100, vat: 135 });
    expect(boxes.get('7')).toMatchObject({ amount: 400, vat: 60 });
    expect(boxes.get('13')!.vat).toBe(75);
    expect(boxes.get('16')!.vat).toBe(75);
    expect(boxes.size).toBe(16);
  });
});

describe('sales analysis', () => {
  const fact = (over: Partial<SalesFact>): SalesFact => ({
    source: 'invoice',
    docId: 'd1',
    number: 'INV-1',
    date: '2026-01-05',
    partnerId: 'c1',
    productId: 'p1',
    categoryId: 'cat',
    branchId: null,
    userId: 'u1',
    quantity: 1,
    net: 100,
    tax: 14,
    cost: 60,
    costSource: 'stock_moves',
    ...over,
  });

  it('aggregates quantities, amounts, documents and gross profit', () => {
    const rows = aggregate(
      [fact({}), fact({ docId: 'd2', quantity: 2, net: 200, tax: 28, cost: 100 }), fact({ productId: 'p2' })],
      (f) => f.productId,
      (k) => ({ name: k }),
      true,
    );
    const p1 = rows.find((r) => r.key === 'p1')!;
    expect(p1).toMatchObject({ documents: 2, quantity: 3, net: 300, tax: 42, total: 342, cost: 160, grossProfit: 140 });
    expect(p1.margin).toBeCloseTo(46.67, 2);
  });

  it('uses stock-move costs, falls back to product cost, and negates credit notes', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM sales_invoice_lines')) {
        return [
          { docId: 'i1', number: 'INV-1', date: '2026-01-05', moveType: 'invoice', rate: '1', orderId: 'o1', productId: 'p1', quantity: '2', lineTotal: '200', taxRate: '14', productType: 'goods', costPrice: '70' },
          { docId: 'i2', number: 'INV-2', date: '2026-01-06', moveType: 'invoice', rate: '2', orderId: null, productId: 'p1', quantity: '1', lineTotal: '100', taxRate: '0', productType: 'goods', costPrice: '70' },
          { docId: 'c1', number: 'RINV-1', date: '2026-01-07', moveType: 'credit_note', rate: '1', orderId: 'o1', productId: 'p1', quantity: '1', lineTotal: '100', taxRate: '14', productType: 'goods', costPrice: '70' },
          { docId: 'i3', number: 'INV-3', date: '2026-01-08', moveType: 'invoice', rate: '1', orderId: null, productId: 's1', quantity: '1', lineTotal: '50', taxRate: '14', productType: 'service', costPrice: '0' },
        ];
      }
      if (sql.includes('FROM stock_movements')) {
        return [{ referenceId: 'o1', productId: 'p1', value: '120', qty: '2' }];
      }
      return [];
    });
    const service = new SalesAnalysisService({ query } as any);
    const facts = await service.salesFacts('t1', { source: 'invoices' });
    expect(facts.map((f) => [f.number, f.quantity, f.net, f.tax, f.cost, f.costSource])).toEqual([
      ['INV-1', 2, 200, 28, 120, 'stock_moves'],
      ['INV-2', 1, 200, 0, 70, 'product_cost'],
      ['RINV-1', -1, -100, -14, -60, 'stock_moves'],
      ['INV-3', 1, 50, 7, 0, 'none'],
    ]);
  });
});

describe('ReportExportService', () => {
  const service = new ReportExportService();
  const spec = () => ({
    title: { en: 'Test', ar: 'اختبار' },
    filename: 'test',
    sheets: [
      {
        name: { en: 'Sheet', ar: 'ورقة' },
        columns: [
          { key: 'name', label: { en: 'Name', ar: 'الاسم' } },
          { key: 'amount', label: { en: 'Amount', ar: 'المبلغ' }, type: 'money' as const },
        ],
        rows: [{ name: 'عميل', amount: '12.5' }],
        totals: { name: 'Total', amount: 12.5 },
      },
      { name: { en: 'Sheet', ar: 'ورقة' }, columns: [], rows: [] },
    ],
  });

  it('returns JSON data unchanged unless xlsx is requested', async () => {
    const data = { a: 1 };
    await expect(service.respond(undefined, undefined, data, spec)).resolves.toBe(data);
    await expect(service.respond('json', 'ar', data, spec)).resolves.toBe(data);
  });

  it('builds an Excel file that the response envelope leaves untouched', async () => {
    const file = await service.respond('xlsx', 'ar', {}, spec);
    expect(file).toBeInstanceOf(ExcelFile);
    const headers = (file as ExcelFile).getHeaders();
    expect(headers.type).toContain('spreadsheetml');
    expect(headers.disposition).toContain('test.xlsx');

    const interceptor = new ResponseInterceptor();
    const ctx: any = { switchToHttp: () => ({ getRequest: () => ({}) }) };
    const out = await lastValueFrom(interceptor.intercept(ctx, { handle: () => of(file) }));
    expect(out).toBe(file);
  });

  it('writes a right-to-left workbook with unique sheet names', async () => {
    const ExcelJS = await import('exceljs');
    const buffer = await service.toXlsx(spec(), 'ar');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['ورقة', 'ورقة (2)']);
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);
    const values = ws.getSheetValues().filter(Boolean).map((r: any) => r.filter((x: unknown) => x !== undefined));
    expect(values).toContainEqual(['الاسم', 'المبلغ']);
    expect(values).toContainEqual(['عميل', 12.5]);
  });
});
