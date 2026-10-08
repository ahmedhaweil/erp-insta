import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tenant } from '@modules/tenants/entities/tenant.entity';
import { Branch } from '@modules/tenants/entities/branch.entity';
import { Currency } from '@modules/accounting/entities/currency.entity';
import { Account } from '@modules/accounting/entities/account.entity';
import { SalesInvoice, SalesInvoiceType } from '@modules/sales/entities/sales-invoice.entity';
import { SalesOrder, SalesOrderStatus } from '@modules/sales/entities/sales-order.entity';
import { Customer } from '@modules/sales/entities/customer.entity';
import { PurchaseOrder, PurchaseOrderStatus } from '@modules/purchasing/entities/purchase-order.entity';
import { PurchaseInvoice } from '@modules/purchasing/entities/purchase-invoice.entity';
import { Supplier } from '@modules/purchasing/entities/supplier.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Unit } from '@modules/inventory/entities/unit.entity';
import { Warehouse } from '@modules/inventory/entities/warehouse.entity';
import { StockMovement } from '@modules/inventory/entities/stock-movement.entity';
import { TreasuryVoucher, VoucherType } from '@modules/treasury/entities/treasury-voucher.entity';
import { Treasury } from '@modules/treasury/entities/treasury.entity';
import { Cheque } from '@modules/treasury/entities/cheque.entity';
import { Payment, PaymentDirection, PaymentPartnerType } from '@modules/payments/entities/payment.entity';
import { PaymentAllocation } from '@modules/payments/entities/payment-allocation.entity';
import { PosOrder, PosOrderStatus } from '@modules/pos/entities/pos-order.entity';
import { PosSession } from '@modules/pos/entities/pos-session.entity';
import { PosTerminal } from '@modules/pos/entities/pos-terminal.entity';
import { User } from '@modules/auth/entities/user.entity';
import { PayrollRun } from '@modules/hr/entities/payroll-run.entity';
import { PayrollLine } from '@modules/hr/entities/payroll-line.entity';
import { Employee } from '@modules/hr/entities/employee.entity';
import { Department } from '@modules/hr/entities/department.entity';
import { JobTitle } from '@modules/hr/entities/job-title.entity';
import { EInvoice, EInvoiceProvider } from '@modules/compliance/entities/e-invoice.entity';
import { EReceipt } from '@modules/compliance/entities/e-receipt.entity';
import { ComplianceCountry, ComplianceSettings } from '@modules/compliance/entities/compliance-settings.entity';
import { zatcaQr } from '@modules/compliance/zatca/zatca-tlv';
import { PartnerStatementService } from '@modules/reports/services/partner-statement.service';
import { CompanyHeader, PrintLang } from '../templates/document.model';
import { localName } from '../templates/format';
import {
  LineView,
  OrderView,
  PartyView,
  PayrollRegisterView,
  PayslipView,
  PosReceiptView,
  StatementView,
  TaxDocumentView,
  VoucherView,
} from '../builders/views';

export interface TenantInfo {
  company: CompanyHeader;
  /** Seller details for tax documents (compliance settings override the tenant). */
  seller: PartyView;
  baseCurrency: string;
  saudi: boolean;
}

/**
 * Loads the records to print (read-only) and maps them to the builders'
 * plain views. Every query is scoped by tenant.
 */
@Injectable()
export class PrintDataService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(Currency) private readonly currencyRepo: Repository<Currency>,
    @InjectRepository(Account) private readonly accountRepo: Repository<Account>,
    @InjectRepository(SalesInvoice) private readonly invoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(SalesOrder) private readonly salesOrderRepo: Repository<SalesOrder>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(PurchaseOrder) private readonly purchaseOrderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseInvoice) private readonly billRepo: Repository<PurchaseInvoice>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    @InjectRepository(Warehouse) private readonly warehouseRepo: Repository<Warehouse>,
    @InjectRepository(StockMovement) private readonly movementRepo: Repository<StockMovement>,
    @InjectRepository(TreasuryVoucher) private readonly voucherRepo: Repository<TreasuryVoucher>,
    @InjectRepository(Treasury) private readonly treasuryRepo: Repository<Treasury>,
    @InjectRepository(Cheque) private readonly chequeRepo: Repository<Cheque>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentAllocation) private readonly allocationRepo: Repository<PaymentAllocation>,
    @InjectRepository(PosOrder) private readonly posOrderRepo: Repository<PosOrder>,
    @InjectRepository(PosSession) private readonly posSessionRepo: Repository<PosSession>,
    @InjectRepository(PosTerminal) private readonly posTerminalRepo: Repository<PosTerminal>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(PayrollRun) private readonly runRepo: Repository<PayrollRun>,
    @InjectRepository(PayrollLine) private readonly payrollLineRepo: Repository<PayrollLine>,
    @InjectRepository(Employee) private readonly employeeRepo: Repository<Employee>,
    @InjectRepository(Department) private readonly departmentRepo: Repository<Department>,
    @InjectRepository(JobTitle) private readonly jobTitleRepo: Repository<JobTitle>,
    @InjectRepository(EInvoice) private readonly eInvoiceRepo: Repository<EInvoice>,
    @InjectRepository(EReceipt) private readonly eReceiptRepo: Repository<EReceipt>,
    @InjectRepository(ComplianceSettings) private readonly complianceRepo: Repository<ComplianceSettings>,
    private readonly statements: PartnerStatementService,
  ) {}

  // ------------------------------------------------------------- shared ----

  async tenantInfo(tenantId: string, lang: PrintLang, branchId?: string | null): Promise<TenantInfo> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const settings = await this.complianceRepo.findOne({ where: { tenantId } });
    const branch = branchId ? await this.branchRepo.findOne({ where: { id: branchId, tenantId } }) : null;
    const saudi =
      settings?.country === ComplianceCountry.SA || String(tenant.country ?? '').toUpperCase() === 'SA';
    const baseCurrency = String(tenant.settings?.baseCurrency ?? (saudi ? 'SAR' : 'EGP')).toUpperCase();
    const complianceAddress = settings
      ? [settings.buildingNumber, settings.street, settings.district, settings.regionCity, settings.governate]
          .filter(Boolean)
          .join('، ')
      : '';
    const address = tenant.address || complianceAddress || null;
    const taxId = tenant.taxId || settings?.taxpayerId || null;
    const name = tenant.name || settings?.taxpayerName || '';
    const company: CompanyHeader = {
      name,
      taxId,
      commercialRegistration: settings?.commercialRegistration || null,
      address,
      phone: tenant.phone || null,
      email: tenant.email || null,
      branch: branch ? `${lang === 'ar' ? 'فرع' : 'Branch'}: ${branch.name}` : null,
    };
    return {
      company,
      seller: {
        name: settings?.taxpayerName || name,
        taxId: settings?.taxpayerId || taxId,
        commercialRegistration: settings?.commercialRegistration || null,
        address: complianceAddress || address,
        phone: tenant.phone,
        email: tenant.email,
      },
      baseCurrency,
      saudi,
    };
  }

  async currencyCode(currencyId: string | null | undefined, fallback: string): Promise<string> {
    if (!currencyId) return fallback;
    const currency = await this.currencyRepo.findOne({ where: { id: currencyId } });
    return currency?.code ?? fallback;
  }

  private customerParty(c: Customer | null, lang: PrintLang): PartyView {
    if (!c) return { name: '' };
    return {
      code: c.code,
      name: localName(c, lang),
      taxId: c.taxId,
      address: c.address,
      city: c.city,
      phone: c.phone,
      email: c.email,
    };
  }

  private supplierParty(s: Supplier | null, lang: PrintLang): PartyView {
    if (!s) return { name: '' };
    return {
      code: s.code,
      name: localName(s, lang),
      taxId: s.taxId,
      address: s.address,
      city: s.city,
      phone: s.phone,
      email: s.email,
    };
  }

  /** Product names / codes / base units of the lines. */
  private async products(tenantId: string, ids: string[], lang: PrintLang) {
    const unique = [...new Set(ids.filter(Boolean))];
    const products = unique.length ? await this.productRepo.find({ where: { tenantId, id: In(unique) } }) : [];
    const unitIds = [...new Set(products.map((p) => p.unitId).filter(Boolean))];
    const units = unitIds.length ? await this.unitRepo.find({ where: { tenantId, id: In(unitIds) } }) : [];
    const unitName = new Map(units.map((u) => [u.id, localName(u, lang) || u.symbol]));
    return new Map(
      products.map((p) => [p.id, { code: p.code, name: localName(p, lang), unit: unitName.get(p.unitId) ?? '' }]),
    );
  }

  private async lineViews(
    tenantId: string,
    lang: PrintLang,
    lines: {
      productId: string;
      description?: string | null;
      quantity: number;
      unitPrice: number;
      discount: number;
      taxRate: number;
      lineTotal: number;
    }[],
  ): Promise<LineView[]> {
    const products = await this.products(
      tenantId,
      lines.map((l) => l.productId),
      lang,
    );
    return lines.map((l) => {
      const p = products.get(l.productId);
      return {
        productCode: p?.code,
        productName: p?.name || l.description || '',
        description: l.description,
        unit: p?.unit,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discount || 0),
        taxRate: Number(l.taxRate || 0),
        lineTotal: Number(l.lineTotal),
      };
    });
  }

  private async branchName(tenantId: string, branchId?: string | null) {
    if (!branchId) return null;
    return (await this.branchRepo.findOne({ where: { id: branchId, tenantId } }))?.name ?? null;
  }

  // -------------------------------------------------------- sales invoice ----

  async salesInvoice(tenantId: string, id: string, lang: PrintLang) {
    const inv = await this.invoiceRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!inv) throw new NotFoundException('Sales invoice not found');
    const info = await this.tenantInfo(tenantId, lang, inv.branchId);
    const currencyCode = await this.currencyCode(inv.currencyId, info.baseCurrency);
    const customer = await this.customerRepo.findOne({ where: { id: inv.customerId, tenantId } });
    const original = inv.reversedInvoiceId
      ? await this.invoiceRepo.findOne({ where: { id: inv.reversedInvoiceId, tenantId } })
      : null;
    const order = inv.orderId ? await this.salesOrderRepo.findOne({ where: { id: inv.orderId, tenantId } }) : null;
    const eDocs = await this.eInvoiceRepo.find({
      where: { tenantId, invoiceId: inv.id },
      order: { createdAt: 'DESC' },
    });
    const eta = eDocs.find((e) => e.provider === EInvoiceProvider.ETA);
    const zatca = eDocs.find((e) => e.provider === EInvoiceProvider.ZATCA);

    const issuedAt = inv.postedAt ?? inv.createdAt;
    let qr: string | null = zatca?.qrContent || null;
    if (!qr && info.saudi) {
      // Phase-1 QR (seller, VAT number, timestamp, total, VAT) until the
      // invoice is reported/cleared and carries its signed QR.
      qr = zatcaQr({
        sellerName: info.seller.name,
        vatNumber: info.seller.taxId ?? '',
        timestamp: new Date(issuedAt ?? `${inv.date}T00:00:00Z`).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        totalWithVat: Number(inv.totalAmount),
        vatTotal: Number(inv.taxAmount),
      });
    }
    const view: TaxDocumentView = {
      kind: inv.moveType === SalesInvoiceType.CREDIT_NOTE ? 'credit_note' : 'invoice',
      number: inv.invoiceNumber,
      date: inv.date,
      dueDate: inv.dueDate,
      issuedAt,
      status: inv.status,
      pricesIncludeTax: inv.pricesIncludeTax,
      exchangeRate: Number(inv.exchangeRate),
      subtotal: Number(inv.subtotal),
      taxAmount: Number(inv.taxAmount),
      totalAmount: Number(inv.totalAmount),
      paidAmount: Number(inv.paidAmount),
      withholdingAmount: Number(inv.withholdingAmount),
      installmentInterest: Number(inv.installmentInterest),
      notes: inv.notes,
      originalNumber: original?.invoiceNumber ?? null,
      orderNumber: order?.orderNumber ?? null,
      branchName: null,
      seller: info.seller,
      buyer: this.customerParty(customer, lang),
      lines: await this.lineViews(tenantId, lang, inv.lines ?? []),
      saudi: info.saudi,
      zatcaQr: qr,
      zatcaUuid: zatca?.uuid ?? null,
      eta: eta ? { uuid: eta.uuid, status: eta.status, url: eta.qrContent } : null,
    };
    return { view, info, currencyCode };
  }

  // ------------------------------------------------------------- orders ----

  async salesOrder(tenantId: string, id: string, lang: PrintLang, kind?: 'quotation' | 'order') {
    const order = await this.salesOrderRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!order) throw new NotFoundException('Sales order not found');
    const info = await this.tenantInfo(tenantId, lang, order.branchId);
    const currencyCode = await this.currencyCode(order.currencyId, info.baseCurrency);
    const customer = await this.customerRepo.findOne({ where: { id: order.customerId, tenantId } });
    const quotation =
      kind === 'quotation' ||
      (!kind && [SalesOrderStatus.DRAFT, SalesOrderStatus.SENT].includes(order.status));
    const warehouse = order.warehouseId
      ? await this.warehouseRepo.findOne({ where: { id: order.warehouseId, tenantId } })
      : null;
    const view: OrderView = {
      kind: quotation ? 'quotation' : 'sales_order',
      number: order.orderNumber,
      date: order.date,
      secondaryDate: order.validityDate,
      status: order.status,
      pricesIncludeTax: order.pricesIncludeTax,
      subtotal: Number(order.subtotal),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      notes: order.notes,
      warehouseName: quotation ? null : warehouse ? localName(warehouse, lang) : null,
      partner: this.customerParty(customer, lang),
      lines: await this.lineViews(tenantId, lang, order.lines ?? []),
    };
    return { view, info, currencyCode };
  }

  /**
   * Delivery note of a sales order: quantities delivered so far, or only the
   * goods issued on `date` (stock movements of the order on that day).
   */
  async deliveryNote(tenantId: string, id: string, lang: PrintLang, date?: string) {
    const order = await this.salesOrderRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!order) throw new NotFoundException('Sales order not found');
    const info = await this.tenantInfo(tenantId, lang, order.branchId);
    const customer = await this.customerRepo.findOne({ where: { id: order.customerId, tenantId } });
    const base = await this.lineViews(tenantId, lang, order.lines ?? []);

    let onNote: Map<string, number> | null = null;
    let warehouseId = order.warehouseId;
    if (date) {
      const moves = await this.movementRepo
        .createQueryBuilder('m')
        .where('m.tenant_id = :tenantId', { tenantId })
        .andWhere('m.reference_type = :type AND m.reference_id = :id', { type: 'sales_order', id: order.id })
        .andWhere('m.created_at::date = :date', { date })
        .getMany();
      onNote = new Map<string, number>();
      for (const m of moves) {
        onNote.set(m.productId, (onNote.get(m.productId) ?? 0) + Math.abs(Number(m.quantity)));
        warehouseId = m.warehouseId || warehouseId;
      }
      if (!moves.length) throw new BadRequestException('Nothing was delivered on this date');
    }
    const warehouse = warehouseId ? await this.warehouseRepo.findOne({ where: { id: warehouseId, tenantId } }) : null;

    // Quantities on the note: delivered so far (or on the date); fall back
    // to the ordered quantity for an order not yet delivered (picking list).
    const remainingByProduct = new Map(onNote ?? []);
    const lines: LineView[] = [];
    (order.lines ?? []).forEach((l, i) => {
      const ordered = Number(l.quantity);
      let qty: number;
      if (onNote) {
        const left = remainingByProduct.get(l.productId) ?? 0;
        qty = Math.min(left, Number(l.qtyDelivered));
        remainingByProduct.set(l.productId, left - qty);
        if (qty <= 0) return;
      } else {
        qty = Number(l.qtyDelivered) > 0 ? Number(l.qtyDelivered) : ordered;
      }
      lines.push({ ...base[i], quantity: qty, ordered, delivered: Number(l.qtyDelivered) });
    });

    const view: OrderView = {
      kind: 'delivery_note',
      number: order.orderNumber,
      date: date ?? order.date,
      status: order.status,
      subtotal: 0,
      taxAmount: 0,
      totalAmount: 0,
      notes: order.notes,
      warehouseName: warehouse ? localName(warehouse, lang) : null,
      reference: order.orderNumber,
      partner: this.customerParty(customer, lang),
      lines,
    };
    return { view, info, currencyCode: info.baseCurrency };
  }

  async purchaseOrder(tenantId: string, id: string, lang: PrintLang) {
    const po = await this.purchaseOrderRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!po) throw new NotFoundException('Purchase order not found');
    const info = await this.tenantInfo(tenantId, lang, po.branchId);
    const currencyCode = await this.currencyCode(po.currencyId, info.baseCurrency);
    const supplier = await this.supplierRepo.findOne({ where: { id: po.supplierId, tenantId } });
    const warehouse = po.warehouseId
      ? await this.warehouseRepo.findOne({ where: { id: po.warehouseId, tenantId } })
      : null;
    const rfq = [PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.SENT].includes(po.status);
    const view: OrderView = {
      kind: rfq ? 'rfq' : 'purchase_order',
      number: po.orderNumber,
      date: po.date,
      secondaryDate: po.expectedDate,
      status: po.status,
      pricesIncludeTax: po.pricesIncludeTax,
      subtotal: Number(po.subtotal),
      taxAmount: Number(po.taxAmount),
      totalAmount: Number(po.totalAmount),
      notes: po.notes,
      warehouseName: warehouse ? localName(warehouse, lang) : null,
      partner: this.supplierParty(supplier, lang),
      lines: await this.lineViews(tenantId, lang, po.lines ?? []),
    };
    return { view, info, currencyCode };
  }

  // ----------------------------------------------------------- vouchers ----

  async treasuryVoucher(tenantId: string, id: string, lang: PrintLang) {
    const v = await this.voucherRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!v) throw new NotFoundException('Voucher not found');
    const info = await this.tenantInfo(tenantId, lang, v.branchId);
    const currencyCode = await this.currencyCode(v.currencyId, info.baseCurrency);
    const treasury = await this.treasuryRepo.findOne({ where: { id: v.treasuryId, tenantId } });
    const accountIds = [...new Set((v.lines ?? []).map((l) => l.accountId))];
    const accounts = accountIds.length
      ? await this.accountRepo.find({ where: { tenantId, id: In(accountIds) } })
      : [];
    const accountName = new Map(accounts.map((a) => [a.id, `${a.code} - ${localName(a, lang)}`]));
    const view: VoucherView = {
      kind: v.type === VoucherType.RECEIPT ? 'receipt' : 'payment',
      number: v.voucherNumber,
      date: v.date,
      status: v.status,
      amount: Number(v.amount),
      method: treasury?.type === 'bank' ? 'bank' : 'cash',
      treasuryName: treasury ? localName(treasury, lang) : null,
      reference: v.reference,
      description: v.description,
      counterparty: { name: v.counterpartyName ?? '' },
      lines: (v.lines ?? []).map((l) => ({
        account: accountName.get(l.accountId) ?? '',
        description: l.description,
        amount: Number(l.amount),
      })),
    };
    return { view, info, currencyCode };
  }

  async payment(tenantId: string, id: string, lang: PrintLang) {
    const p = await this.paymentRepo.findOne({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Payment not found');
    const info = await this.tenantInfo(tenantId, lang);
    const currencyCode = await this.currencyCode(p.currencyId, info.baseCurrency);
    const isCustomer = p.partnerType === PaymentPartnerType.CUSTOMER;
    const partner = isCustomer
      ? this.customerParty(await this.customerRepo.findOne({ where: { id: p.partnerId, tenantId } }), lang)
      : this.supplierParty(await this.supplierRepo.findOne({ where: { id: p.partnerId, tenantId } }), lang);
    const treasury = p.treasuryId ? await this.treasuryRepo.findOne({ where: { id: p.treasuryId, tenantId } }) : null;
    const allocations = await this.allocationRepo.find({ where: { paymentId: p.id } });
    const salesIds = allocations.filter((a) => a.invoiceType === 'sales_invoice').map((a) => a.invoiceId);
    const billIds = allocations.filter((a) => a.invoiceType === 'purchase_invoice').map((a) => a.invoiceId);
    const numbers = new Map<string, string>();
    if (salesIds.length) {
      for (const i of await this.invoiceRepo.find({ where: { tenantId, id: In(salesIds) } }))
        numbers.set(i.id, i.invoiceNumber);
    }
    if (billIds.length) {
      for (const b of await this.billRepo.find({ where: { tenantId, id: In(billIds) } }))
        numbers.set(b.id, b.invoiceNumber);
    }
    const cheque = p.chequeId ? await this.chequeRepo.findOne({ where: { id: p.chequeId, tenantId } }) : null;
    const view: VoucherView = {
      kind: p.direction === PaymentDirection.INBOUND ? 'receipt' : 'payment',
      number: p.paymentNumber,
      date: p.date,
      status: p.status,
      amount: Number(p.amount),
      withholdingAmount: Number(p.withholdingAmount || 0),
      method: p.method,
      treasuryName: treasury ? localName(treasury, lang) : null,
      reference: p.reference,
      counterparty: partner,
      counterpartyType: isCustomer ? 'customer' : 'supplier',
      lines: [],
      allocations: allocations.map((a) => ({ number: numbers.get(a.invoiceId) ?? a.invoiceId, amount: Number(a.amount) })),
      cheque: cheque ? { number: cheque.chequeNumber, bank: cheque.bankName, dueDate: cheque.dueDate } : null,
    };
    return { view, info, currencyCode };
  }

  // ---------------------------------------------------------------- POS ----

  async posOrder(tenantId: string, id: string, lang: PrintLang) {
    const order = await this.posOrderRepo.findOne({ where: { id, tenantId }, relations: ['lines'] });
    if (!order) throw new NotFoundException('POS order not found');
    const session = await this.posSessionRepo.findOne({ where: { id: order.sessionId, tenantId } });
    const terminal = session
      ? await this.posTerminalRepo.findOne({ where: { id: session.terminalId, tenantId } })
      : null;
    const info = await this.tenantInfo(tenantId, lang, terminal?.branchId);
    const cashier = order.createdBy ? await this.userRepo.findOne({ where: { id: order.createdBy, tenantId } }) : null;
    const customer = order.customerId
      ? await this.customerRepo.findOne({ where: { id: order.customerId, tenantId } })
      : null;
    const eReceipt = await this.eReceiptRepo.findOne({ where: { tenantId, posOrderId: order.id } });
    let qr: string | null = eReceipt?.qrContent || null;
    if (!qr && info.saudi) {
      qr = zatcaQr({
        sellerName: info.seller.name,
        vatNumber: info.seller.taxId ?? '',
        timestamp: new Date(order.createdAt ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        totalWithVat: Math.abs(Number(order.totalAmount)),
        vatTotal: Math.abs(Number(order.taxAmount)),
      });
    }
    const lines = await this.lineViews(tenantId, lang, order.lines ?? []);
    const view: PosReceiptView = {
      number: order.orderNumber,
      date: order.createdAt,
      refund: !!order.refundedOrderId,
      status: order.status === PosOrderStatus.COMPLETED ? 'completed' : order.status,
      terminalName: terminal?.name,
      cashierName: cashier?.name,
      paymentMethod: order.paymentMethod,
      subtotal: Number(order.subtotal),
      discount: Number(order.discount || 0),
      taxAmount: Number(order.taxAmount),
      totalAmount: Number(order.totalAmount),
      cashReceived: Number(order.cashReceived || 0),
      changeAmount: Number(order.changeAmount || 0),
      customer: customer ? this.customerParty(customer, lang) : null,
      lines,
      qr,
      eReceiptUuid: eReceipt?.uuid ?? null,
      saudi: info.saudi,
    };
    return { view, info, currencyCode: info.baseCurrency };
  }

  // ------------------------------------------------------------- payroll ----

  async payslip(tenantId: string, lineId: string, lang: PrintLang) {
    const line = await this.payrollLineRepo.findOne({ where: { id: lineId }, relations: ['run'] });
    if (!line || line.run?.tenantId !== tenantId) throw new NotFoundException('Payslip not found');
    const run = line.run;
    const info = await this.tenantInfo(tenantId, lang, line.branchId);
    const view = await this.payslipView(tenantId, run, line, lang);
    return { view, info, currencyCode: line.payrollCountry === 'SA' ? 'SAR' : info.baseCurrency };
  }

  /** All payslips of a run (for batch printing). */
  async runPayslips(tenantId: string, runId: string, lang: PrintLang) {
    const run = await this.runRepo.findOne({ where: { id: runId, tenantId }, relations: ['lines'] });
    if (!run) throw new NotFoundException('Payroll run not found');
    const info = await this.tenantInfo(tenantId, lang, run.branchId);
    const lines = [...(run.lines ?? [])].sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
    const views = [];
    for (const line of lines) {
      views.push({
        view: await this.payslipView(tenantId, run, line, lang),
        currencyCode: line.payrollCountry === 'SA' ? 'SAR' : info.baseCurrency,
      });
    }
    return { views, info, run };
  }

  private async payslipView(tenantId: string, run: PayrollRun, line: PayrollLine, lang: PrintLang): Promise<PayslipView> {
    const employee = await this.employeeRepo.findOne({ where: { id: line.employeeId, tenantId } });
    const department = line.departmentId
      ? await this.departmentRepo.findOne({ where: { id: line.departmentId, tenantId } })
      : null;
    const jobTitle = employee?.jobTitleId
      ? await this.jobTitleRepo.findOne({ where: { id: employee.jobTitleId, tenantId } })
      : null;
    const pick = (r: { name?: string; nameAr?: string } | null) =>
      r ? (lang === 'ar' ? r.nameAr || r.name : r.name || r.nameAr) ?? null : null;
    const allowances = ((line.details?.earnings?.allowances as { name: string; amount: number }[]) ?? [])
      .filter((a) => Number(a.amount) > 0)
      .map((a) => ({ name: a.name, amount: Number(a.amount) }));
    return {
      runNumber: run.runNumber,
      period: run.period,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      employee: {
        code: line.employeeCode,
        name: employee ? localName(employee, lang) : line.employeeName,
        nationalId: employee?.nationalId,
        department: pick(department),
        jobTitle: pick(jobTitle),
        bankName: employee?.bankName,
        iban: employee?.iban,
        hireDate: employee?.hireDate,
      },
      basic: Number(line.basic),
      allowances,
      allowancesTotal: Number(line.allowancesTotal),
      overtimePay: Number(line.overtimePay),
      additionsTotal: Number(line.additionsTotal),
      gross: Number(line.gross),
      attendanceDeductions: Number(line.attendanceDeductions),
      employeeSi: Number(line.employeeSi),
      employerSi: Number(line.employerSi),
      incomeTax: Number(line.incomeTax),
      loanDeduction: Number(line.loanDeduction),
      otherDeductions: Number(line.otherDeductions),
      totalDeductions: Number(line.totalDeductions),
      net: Number(line.net),
    };
  }

  async payrollRegister(tenantId: string, runId: string, lang: PrintLang) {
    const run = await this.runRepo.findOne({ where: { id: runId, tenantId }, relations: ['lines'] });
    if (!run) throw new NotFoundException('Payroll run not found');
    const info = await this.tenantInfo(tenantId, lang, run.branchId);
    const employeeIds = (run.lines ?? []).map((l) => l.employeeId);
    const employees = employeeIds.length
      ? await this.employeeRepo.find({ where: { tenantId, id: In(employeeIds) } })
      : [];
    const names = new Map(employees.map((e) => [e.id, localName(e, lang)]));
    const department = run.departmentId
      ? await this.departmentRepo.findOne({ where: { id: run.departmentId, tenantId } })
      : null;
    const n = (v: unknown) => Number(v || 0);
    const view: PayrollRegisterView = {
      runNumber: run.runNumber,
      period: run.period,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      branchName: await this.branchName(tenantId, run.branchId),
      departmentName: department ? (lang === 'ar' ? department.nameAr || department.name : department.name) : null,
      lines: [...(run.lines ?? [])]
        .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode))
        .map((l) => ({
          employeeCode: l.employeeCode,
          employeeName: names.get(l.employeeId) || l.employeeName,
          basic: n(l.basic),
          allowancesTotal: n(l.allowancesTotal),
          overtimePay: n(l.overtimePay),
          additionsTotal: n(l.additionsTotal),
          gross: n(l.gross),
          attendanceDeductions: n(l.attendanceDeductions),
          employeeSi: n(l.employeeSi),
          incomeTax: n(l.incomeTax),
          loanDeduction: n(l.loanDeduction),
          otherDeductions: n(l.otherDeductions),
          totalDeductions: n(l.totalDeductions),
          net: n(l.net),
          employerSi: n(l.employerSi),
        })),
    };
    return { view, info, currencyCode: info.baseCurrency };
  }

  // ----------------------------------------------------------- statement ----

  async statement(
    tenantId: string,
    partnerType: 'customer' | 'supplier',
    partnerId: string,
    lang: PrintLang,
    from?: string,
    to?: string,
  ) {
    const data = await this.statements.getStatement(tenantId, { partnerType, partnerId, from, to });
    const info = await this.tenantInfo(tenantId, lang);
    const partnerRec =
      partnerType === 'customer'
        ? await this.customerRepo.findOne({ where: { id: partnerId, tenantId } })
        : await this.supplierRepo.findOne({ where: { id: partnerId, tenantId } });
    const view: StatementView = {
      partnerType,
      partner: {
        code: data.partner.code,
        name: localName(data.partner, lang),
        taxId: data.partner.taxId,
        phone: data.partner.phone,
        address: partnerRec?.address,
      },
      from: data.from,
      to: data.to,
      openingBalance: data.openingBalance,
      closingBalance: data.closingBalance,
      totalDebit: data.totalDebit,
      totalCredit: data.totalCredit,
      lines: data.lines.map((l) => ({
        date: l.date,
        documentType: l.documentType,
        number: l.number,
        reference: l.reference,
        dueDate: l.dueDate,
        description: l.description,
        debit: l.debit,
        credit: l.credit,
        balance: l.balance,
      })),
    };
    return { view, info, currencyCode: info.baseCurrency };
  }

  // -------------------------------------------------------------- cheque ----

  async cheque(tenantId: string, id: string, lang: PrintLang) {
    const cheque = await this.chequeRepo.findOne({ where: { id, tenantId } });
    if (!cheque) throw new NotFoundException('Cheque not found');
    let payee = cheque.drawer ?? '';
    if (cheque.partnerType === 'supplier' && cheque.partnerId) {
      const s = await this.supplierRepo.findOne({ where: { id: cheque.partnerId, tenantId } });
      if (s) payee = localName(s, lang);
    } else if (cheque.partnerType === 'customer' && cheque.partnerId) {
      const c = await this.customerRepo.findOne({ where: { id: cheque.partnerId, tenantId } });
      if (c) payee = localName(c, lang);
    }
    const treasury = cheque.treasuryId
      ? await this.treasuryRepo.findOne({ where: { id: cheque.treasuryId, tenantId } })
      : null;
    const info = await this.tenantInfo(tenantId, lang);
    const currencyCode = await this.currencyCode(cheque.currencyId, info.baseCurrency);
    return { cheque, payee, treasury, currencyCode };
  }
}
