/** Sample data used by the printing smoke tests and for visual checks. */
import {
  OrderView,
  PayrollRegisterView,
  PayslipView,
  PosReceiptView,
  PrintContext,
  StatementView,
  TaxDocumentView,
  VoucherView,
} from './builders/views';
import { zatcaQr } from '@modules/compliance/zatca/zatca-tlv';
import { Paper, PrintLang } from './templates/document.model';

export function sampleContext(lang: PrintLang = 'ar', paper: Paper = 'a4', currencyCode = 'EGP'): PrintContext {
  return {
    lang,
    paper,
    currencyCode,
    company: {
      name: lang === 'ar' ? 'شركة النور للتجارة والتوزيع (ش.م.م)' : 'Al Nour Trading & Distribution LLC',
      taxId: '123-456-789',
      commercialRegistration: '98765',
      address: lang === 'ar' ? '15 شارع التحرير، الدقي، الجيزة' : '15 Tahrir St., Dokki, Giza',
      phone: '+20 2 3333 4444',
      email: 'info@alnour.example',
    },
  };
}

const lines = [
  {
    productCode: 'P-001',
    productName: 'لاب توب ديل لاتيتيود 5440',
    description: 'ضمان سنتين',
    unit: 'قطعة',
    quantity: 2,
    unitPrice: 25000,
    discount: 500,
    taxRate: 14,
    lineTotal: 49500,
  },
  {
    productCode: 'P-002',
    productName: 'Wireless mouse (Logitech M185)',
    unit: 'pcs',
    quantity: 5,
    unitPrice: 350.5,
    discount: 0,
    taxRate: 14,
    lineTotal: 1752.5,
  },
  {
    productCode: 'S-010',
    productName: 'خدمة تركيب وتشغيل',
    unit: 'خدمة',
    quantity: 1,
    unitPrice: 1000,
    discount: 0,
    taxRate: 0,
    lineTotal: 1000,
  },
];

export function sampleInvoice(saudi = false): TaxDocumentView {
  const tax = 49500 * 0.14 + 1752.5 * 0.14;
  const subtotal = 52252.5;
  const total = subtotal + tax;
  return {
    kind: 'invoice',
    number: 'INV-2026-00015',
    date: '2026-10-08',
    dueDate: '2026-11-07',
    issuedAt: '2026-10-08T09:30:00Z',
    status: 'posted',
    subtotal,
    taxAmount: tax,
    totalAmount: total,
    paidAmount: 10000,
    notes: 'البضاعة المباعة لا ترد ولا تستبدل بعد 14 يوماً',
    orderNumber: 'SO-2026-0007',
    seller: { name: 'شركة النور للتجارة', taxId: saudi ? '300000000000003' : '123-456-789', address: 'الجيزة' },
    buyer: {
      code: 'C-0001',
      name: 'مؤسسة الأمل للمقاولات',
      taxId: '987-654-321',
      address: '10 شارع الهرم',
      city: 'الجيزة',
      phone: '01000000000',
    },
    lines,
    saudi,
    zatcaQr: saudi
      ? zatcaQr({
          sellerName: 'شركة النور للتجارة',
          vatNumber: '300000000000003',
          timestamp: '2026-10-08T09:30:00Z',
          totalWithVat: total,
          vatTotal: tax,
        })
      : null,
    eta: saudi
      ? null
      : {
          uuid: 'R0SXXTV7DVVWGJ4XC6TP6N0J10',
          status: 'valid',
          url: 'https://invoicing.eta.gov.eg/documents/R0SXXTV7DVVWGJ4XC6TP6N0J10/share/abc',
        },
  };
}

export function sampleOrder(kind: OrderView['kind']): OrderView {
  return {
    kind,
    number: kind === 'purchase_order' ? 'PO-2026-0004' : 'SO-2026-0007',
    date: '2026-10-01',
    secondaryDate: '2026-10-15',
    status: 'confirmed',
    subtotal: 52252.5,
    taxAmount: 7175.35,
    totalAmount: 59427.85,
    warehouseName: 'المخزن الرئيسي',
    partner: { code: 'C-0001', name: 'مؤسسة الأمل للمقاولات', taxId: '987-654-321', phone: '01000000000' },
    lines: lines.map((l) => ({ ...l, ordered: l.quantity + 1, delivered: l.quantity })),
  };
}

export function sampleVoucher(kind: 'receipt' | 'payment' = 'receipt'): VoucherView {
  return {
    kind,
    number: kind === 'receipt' ? 'RV-2026-0003' : 'PV-2026-0011',
    date: '2026-10-08',
    status: 'posted',
    amount: 12500.75,
    method: 'cash',
    treasuryName: 'الخزينة الرئيسية',
    reference: 'REF-77',
    description: 'تحصيل دفعة من حساب العميل',
    counterparty: { name: 'مؤسسة الأمل للمقاولات', code: 'C-0001' },
    counterpartyType: 'customer',
    lines: [{ account: '4101 - إيرادات أخرى', description: 'إيجار مخزن شهر أكتوبر', amount: 12500.75 }],
    allocations: [{ number: 'INV-2026-00015', amount: 12500.75 }],
  };
}

export function samplePos(): PosReceiptView {
  return {
    number: 'POS-000123',
    date: '2026-10-08T12:15:00Z',
    refund: false,
    status: 'completed',
    terminalName: 'كاشير 1',
    cashierName: 'أحمد علي',
    paymentMethod: 'cash',
    subtotal: 300,
    discount: 0,
    taxAmount: 45,
    totalAmount: 345,
    cashReceived: 400,
    changeAmount: 55,
    lines: [
      { productName: 'قهوة عربية 250 جم', quantity: 2, unitPrice: 100, discount: 0, taxRate: 15, lineTotal: 200 },
      { productName: 'Dates box (Sukkari)', quantity: 1, unitPrice: 100, discount: 0, taxRate: 15, lineTotal: 100 },
    ],
    saudi: true,
    qr: zatcaQr({
      sellerName: 'متجر النور',
      vatNumber: '300000000000003',
      timestamp: '2026-10-08T12:15:00Z',
      totalWithVat: 345,
      vatTotal: 45,
    }),
  };
}

export function samplePayslip(): PayslipView {
  return {
    runNumber: 'PR-2026-10',
    period: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    status: 'approved',
    employee: {
      code: 'E-015',
      name: 'محمد أحمد السيد',
      nationalId: '29001010101234',
      department: 'المبيعات',
      jobTitle: 'مندوب مبيعات',
      bankName: 'البنك الأهلي المصري',
      iban: 'EG380019000500000000263180002',
      hireDate: '2022-03-01',
    },
    basic: 8000,
    allowances: [
      { name: 'بدل انتقال', amount: 1000 },
      { name: 'بدل سكن', amount: 1500 },
    ],
    allowancesTotal: 2500,
    overtimePay: 450,
    additionsTotal: 0,
    gross: 10950,
    attendanceDeductions: 266.67,
    employeeSi: 1155,
    employerSi: 1980,
    incomeTax: 512.4,
    loanDeduction: 500,
    otherDeductions: 0,
    totalDeductions: 2434.07,
    net: 8515.93,
  };
}

export function sampleRegister(): PayrollRegisterView {
  const p = samplePayslip();
  const line = {
    employeeCode: p.employee.code,
    employeeName: p.employee.name,
    basic: p.basic,
    allowancesTotal: p.allowancesTotal,
    overtimePay: p.overtimePay,
    additionsTotal: p.additionsTotal,
    gross: p.gross,
    attendanceDeductions: p.attendanceDeductions,
    employeeSi: p.employeeSi,
    incomeTax: p.incomeTax,
    loanDeduction: p.loanDeduction,
    otherDeductions: p.otherDeductions,
    totalDeductions: p.totalDeductions,
    net: p.net,
    employerSi: p.employerSi,
  };
  return {
    runNumber: p.runNumber,
    period: p.period,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    status: 'approved',
    branchName: 'الفرع الرئيسي',
    lines: [line, { ...line, employeeCode: 'E-016', employeeName: 'Sara Hassan' }],
  };
}

export function sampleStatement(): StatementView {
  return {
    partnerType: 'customer',
    partner: { code: 'C-0001', name: 'مؤسسة الأمل للمقاولات', taxId: '987-654-321' },
    from: '2026-01-01',
    to: '2026-10-31',
    openingBalance: 1500,
    closingBalance: 48927.85,
    totalDebit: 59427.85,
    totalCredit: 12000,
    lines: [
      {
        date: '2026-10-08',
        documentType: 'invoice',
        number: 'INV-2026-00015',
        dueDate: '2026-11-07',
        description: 'Sales invoice',
        debit: 59427.85,
        credit: 0,
        balance: 60927.85,
      },
      {
        date: '2026-10-09',
        documentType: 'payment',
        number: 'PAY-2026-0009',
        reference: 'CHQ 1234',
        description: 'Payment (cheque) - INV-2026-00015',
        debit: 0,
        credit: 12000,
        balance: 48927.85,
      },
    ],
  };
}
