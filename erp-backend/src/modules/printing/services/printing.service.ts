import { BadRequestException, Injectable } from '@nestjs/common';
import { ChequeType } from '@modules/treasury/entities/cheque.entity';
import { PrintDataService } from './print-data.service';
import { ChequeLayoutsService } from './cheque-layouts.service';
import { buildOrderDocument, buildTaxDocument } from '../builders/commercial.builder';
import { buildStatement, buildVoucher } from '../builders/finance.builder';
import { buildPayrollRegister, buildPayslip, buildPosReceipt } from '../builders/pos-payroll.builder';
import { PrintContext } from '../builders/views';
import { Paper, PrintDocument, PrintLang } from '../templates/document.model';
import { renderDocument } from '../templates/render';
import { renderCheque } from '../templates/cheque-renderer';
import { amountInWords } from '../engine/number-to-words';
import { money } from '../templates/format';
import { renderA4Batch } from '../templates/a4-renderer';

export interface PrintOptions {
  lang?: PrintLang;
  paper?: 'a4' | '80mm';
}

export interface RenderedPdf {
  buffer: Buffer;
  filename: string;
}

/** Builds and renders the printable documents. */
@Injectable()
export class PrintingService {
  constructor(
    private readonly data: PrintDataService,
    private readonly chequeLayouts: ChequeLayoutsService,
  ) {}

  private ctx(
    loaded: { info: { company: PrintContext['company'] }; currencyCode: string },
    opts: PrintOptions,
    defaultPaper: Paper = 'a4',
  ): PrintContext {
    return {
      lang: opts.lang ?? 'ar',
      paper: opts.paper ?? defaultPaper,
      company: loaded.info.company,
      currencyCode: loaded.currencyCode,
    };
  }

  private async render(doc: PrintDocument): Promise<RenderedPdf> {
    return { buffer: await renderDocument(doc), filename: doc.filename };
  }

  async salesInvoice(tenantId: string, id: string, opts: PrintOptions) {
    const loaded = await this.data.salesInvoice(tenantId, id, opts.lang ?? 'ar');
    return this.render(buildTaxDocument(loaded.view, this.ctx(loaded, opts)));
  }

  async salesOrder(tenantId: string, id: string, opts: PrintOptions & { kind?: 'quotation' | 'order' }) {
    const loaded = await this.data.salesOrder(tenantId, id, opts.lang ?? 'ar', opts.kind);
    return this.render(buildOrderDocument(loaded.view, this.ctx(loaded, opts)));
  }

  async deliveryNote(tenantId: string, id: string, opts: PrintOptions & { date?: string }) {
    const loaded = await this.data.deliveryNote(tenantId, id, opts.lang ?? 'ar', opts.date);
    return this.render(buildOrderDocument(loaded.view, this.ctx(loaded, opts)));
  }

  async purchaseOrder(tenantId: string, id: string, opts: PrintOptions) {
    const loaded = await this.data.purchaseOrder(tenantId, id, opts.lang ?? 'ar');
    return this.render(buildOrderDocument(loaded.view, this.ctx(loaded, opts)));
  }

  async treasuryVoucher(tenantId: string, id: string, opts: PrintOptions) {
    const loaded = await this.data.treasuryVoucher(tenantId, id, opts.lang ?? 'ar');
    return this.render(buildVoucher(loaded.view, this.ctx(loaded, opts)));
  }

  async payment(tenantId: string, id: string, opts: PrintOptions) {
    const loaded = await this.data.payment(tenantId, id, opts.lang ?? 'ar');
    return this.render(buildVoucher(loaded.view, this.ctx(loaded, opts)));
  }

  async posReceipt(tenantId: string, id: string, opts: PrintOptions) {
    const loaded = await this.data.posOrder(tenantId, id, opts.lang ?? 'ar');
    return this.render(buildPosReceipt(loaded.view, this.ctx(loaded, opts, '80mm')));
  }

  async payslip(tenantId: string, lineId: string, opts: PrintOptions) {
    const loaded = await this.data.payslip(tenantId, lineId, opts.lang ?? 'ar');
    return this.render(buildPayslip(loaded.view, this.ctx(loaded, opts)));
  }

  /** Every payslip of a run in one PDF (one or more pages per employee). */
  async runPayslips(tenantId: string, runId: string, opts: PrintOptions) {
    const { views, info, run } = await this.data.runPayslips(tenantId, runId, opts.lang ?? 'ar');
    if (!views.length) throw new BadRequestException('The payroll run has no payslips');
    // Batch printing is A4 only (one payslip per page group).
    const docs = views.map((v) =>
      buildPayslip(v.view, this.ctx({ info, currencyCode: v.currencyCode }, { ...opts, paper: 'a4' })),
    );
    return { buffer: await renderA4Batch(docs), filename: `payslips-${run.runNumber}` };
  }

  async payrollRegister(tenantId: string, runId: string, opts: PrintOptions) {
    const loaded = await this.data.payrollRegister(tenantId, runId, opts.lang ?? 'ar');
    return this.render(buildPayrollRegister(loaded.view, this.ctx(loaded, opts)));
  }

  async statement(
    tenantId: string,
    partnerType: 'customer' | 'supplier',
    partnerId: string,
    opts: PrintOptions & { from?: string; to?: string },
  ) {
    const loaded = await this.data.statement(tenantId, partnerType, partnerId, opts.lang ?? 'ar', opts.from, opts.to);
    return this.render(buildStatement(loaded.view, this.ctx(loaded, opts)));
  }

  /** Prints the fields of an issued cheque on the bank's cheque layout. */
  async cheque(tenantId: string, id: string, opts: { layoutId?: string; lang?: PrintLang }) {
    const loaded = await this.data.cheque(tenantId, id, opts.lang ?? 'ar');
    const { cheque } = loaded;
    if (cheque.type !== ChequeType.ISSUED) {
      throw new BadRequestException('Only issued cheques can be printed');
    }
    const { spec, lang: layoutLang } = await this.chequeLayouts.resolve(tenantId, {
      layoutId: opts.layoutId,
      treasuryId: cheque.treasuryId,
      bankNames: [cheque.bankName, loaded.treasury?.bankName],
    });
    const lang = opts.lang ?? layoutLang;
    const buffer = await renderCheque(spec, {
      date: cheque.dueDate || cheque.issueDate,
      payee: loaded.payee,
      amount: money(cheque.amount),
      amountWords: amountInWords(Number(cheque.amount), loaded.currencyCode, lang),
      memo: cheque.notes,
    });
    return { buffer, filename: `cheque-${cheque.chequeNumber}` };
  }
}
