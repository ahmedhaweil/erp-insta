import { CompanyHeader, Paper, PrintLang } from '../templates/document.model';

/** Plain data handed to the builders (decoupled from the TypeORM entities). */

export interface PrintContext {
  lang: PrintLang;
  paper: Paper;
  company: CompanyHeader;
  /** ISO currency code of the document (EGP, SAR...). */
  currencyCode: string;
}

export interface PartyView {
  code?: string | null;
  name: string;
  taxId?: string | null;
  commercialRegistration?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface LineView {
  productCode?: string | null;
  productName: string;
  description?: string | null;
  unit?: string | null;
  quantity: number;
  unitPrice: number;
  /** Absolute discount amount on the line. */
  discount: number;
  taxRate: number;
  /** Untaxed net amount. */
  lineTotal: number;
  /** Delivery note: quantity ordered / delivered so far / on this note. */
  ordered?: number;
  delivered?: number;
}

export interface TaxDocumentView {
  kind: 'invoice' | 'credit_note';
  number: string;
  date: string;
  dueDate?: string | null;
  issuedAt?: Date | string | null;
  status: string;
  pricesIncludeTax?: boolean;
  exchangeRate?: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount?: number;
  withholdingAmount?: number;
  installmentInterest?: number;
  notes?: string | null;
  originalNumber?: string | null;
  orderNumber?: string | null;
  branchName?: string | null;
  seller: PartyView;
  buyer: PartyView;
  lines: LineView[];
  /** Saudi tenant: print as a ZATCA tax invoice (simplified when the buyer has no VAT number). */
  saudi?: boolean;
  /** ZATCA QR (TLV base64) or null. */
  zatcaQr?: string | null;
  zatcaUuid?: string | null;
  /** ETA submission data when the invoice was sent to the Egyptian Tax Authority. */
  eta?: { uuid?: string | null; status?: string | null; url?: string | null } | null;
}

export interface OrderView {
  kind: 'quotation' | 'sales_order' | 'purchase_order' | 'rfq' | 'delivery_note';
  number: string;
  date: string;
  /** Quotation validity / PO expected date / delivery date. */
  secondaryDate?: string | null;
  status: string;
  pricesIncludeTax?: boolean;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes?: string | null;
  warehouseName?: string | null;
  branchName?: string | null;
  reference?: string | null;
  /** Our company / the customer (sales) or the supplier (purchase). */
  partner: PartyView;
  lines: LineView[];
}

export interface VoucherLineView {
  account?: string | null;
  description?: string | null;
  amount: number;
}

export interface VoucherView {
  kind: 'receipt' | 'payment';
  number: string;
  date: string;
  status: string;
  amount: number;
  /** Withholding tax settled with the payment (customer/supplier payments). */
  withholdingAmount?: number;
  method?: string | null;
  treasuryName?: string | null;
  reference?: string | null;
  description?: string | null;
  counterparty: PartyView;
  /** Counterparty type label (customer/supplier) when relevant. */
  counterpartyType?: 'customer' | 'supplier' | null;
  lines: VoucherLineView[];
  /** Invoices settled by a customer/supplier payment. */
  allocations?: { number: string; amount: number }[];
  cheque?: { number: string; bank?: string | null; dueDate?: string | null } | null;
}

export interface PosReceiptView {
  number: string;
  date: Date | string;
  refund: boolean;
  status: string;
  terminalName?: string | null;
  cashierName?: string | null;
  paymentMethod: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  totalAmount: number;
  cashReceived?: number;
  changeAmount?: number;
  customer?: PartyView | null;
  lines: LineView[];
  /** ZATCA phase-1 QR or ETA e-receipt QR/URL. */
  qr?: string | null;
  eReceiptUuid?: string | null;
  saudi?: boolean;
}

export interface PayslipView {
  runNumber: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  employee: {
    code: string;
    name: string;
    nationalId?: string | null;
    department?: string | null;
    jobTitle?: string | null;
    bankName?: string | null;
    iban?: string | null;
    hireDate?: string | null;
  };
  basic: number;
  allowances: { name: string; amount: number }[];
  allowancesTotal: number;
  overtimePay: number;
  additionsTotal: number;
  gross: number;
  attendanceDeductions: number;
  employeeSi: number;
  employerSi: number;
  incomeTax: number;
  loanDeduction: number;
  otherDeductions: number;
  totalDeductions: number;
  net: number;
}

export interface PayrollRegisterView {
  runNumber: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  branchName?: string | null;
  departmentName?: string | null;
  lines: {
    employeeCode: string;
    employeeName: string;
    basic: number;
    allowancesTotal: number;
    overtimePay: number;
    additionsTotal: number;
    gross: number;
    attendanceDeductions: number;
    employeeSi: number;
    incomeTax: number;
    loanDeduction: number;
    otherDeductions: number;
    totalDeductions: number;
    net: number;
    employerSi: number;
  }[];
}

export interface StatementView {
  partnerType: 'customer' | 'supplier';
  partner: PartyView;
  from?: string | null;
  to: string;
  openingBalance: number;
  closingBalance: number;
  totalDebit: number;
  totalCredit: number;
  lines: {
    date: string;
    documentType: string;
    number: string;
    reference?: string | null;
    dueDate?: string | null;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
}
