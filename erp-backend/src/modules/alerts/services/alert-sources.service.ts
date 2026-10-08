import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { addDays } from '@shared/utils/document-totals.util';
import { AlertType } from '../alert-types';

/** One record that triggers an alert. */
export interface AlertMatch {
  /** Stable id used for de-duplication (document id, period...). */
  recordKey: string;
  /** Short, language-neutral line (codes, dates, amounts). */
  label: string;
  data: Record<string, unknown>;
}

export interface AlertQuery {
  tenantId: string;
  days: number;
  hours: number;
  params: Record<string, unknown>;
  /** Scan date (YYYY-MM-DD) and time. */
  asOf: string;
  now: Date;
}

const money = (n: unknown) => Number(n ?? 0).toFixed(2);

/** Last day (YYYY-MM-DD) of the month `offset` months from the month of `iso`. */
export function monthEnd(iso: string, offset = 0): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10);
}

/**
 * Payroll period to check: the current month from day `dayOfMonth`, the
 * previous month before it.
 */
export function payrollPeriodToCheck(asOf: string, dayOfMonth: number): { period: string; start: string; end: string } {
  const day = Number(asOf.slice(8, 10));
  const end = monthEnd(asOf, day >= dayOfMonth ? 0 : -1);
  return { period: end.slice(0, 7), start: `${end.slice(0, 7)}-01`, end };
}

/** Month end that should be locked once `graceDays` have passed after it. */
export function expectedLockDate(asOf: string, graceDays: number): string {
  return monthEnd(addDays(asOf, -graceDays), -1);
}

/**
 * Read-only queries over other modules' tables (treasury, sales, purchasing,
 * inventory, HR, accounting, compliance, POS) finding the records of each
 * alert type. Plain SQL keeps the alerts module independent of their services.
 */
@Injectable()
export class AlertSourcesService {
  constructor(private readonly dataSource: DataSource) {}

  find(type: AlertType, q: AlertQuery): Promise<AlertMatch[]> {
    switch (type) {
      case AlertType.CHEQUES_DUE:
        return this.chequesDue(q);
      case AlertType.CHEQUES_BOUNCED:
        return this.chequesBounced(q);
      case AlertType.OVERDUE_INVOICES:
        return this.overdueInvoices(q);
      case AlertType.OVERDUE_INSTALLMENTS:
        return this.overdueInstallments(q);
      case AlertType.SUPPLIER_BILLS_DUE:
        return this.supplierBillsDue(q);
      case AlertType.LOTS_EXPIRING:
        return this.lots(q, false);
      case AlertType.EXPIRED_STOCK:
        return this.lots(q, true);
      case AlertType.LOW_STOCK:
        return this.lowStock(q);
      case AlertType.PAYROLL_NOT_RUN:
        return this.payrollNotRun(q);
      case AlertType.PERIOD_NOT_LOCKED:
        return this.periodNotLocked(q);
      case AlertType.EINVOICE_REJECTED:
        return this.einvoicesRejected(q);
      case AlertType.POS_SESSION_OPEN:
        return this.posSessionsOpen(q);
      default:
        return Promise.resolve([]);
    }
  }

  private async chequesDue(q: AlertQuery): Promise<AlertMatch[]> {
    const params: unknown[] = [q.tenantId, addDays(q.asOf, q.days)];
    let typeFilter = '';
    if (q.params.chequeType === 'received' || q.params.chequeType === 'issued') {
      params.push(q.params.chequeType);
      typeFilter = `AND type = $${params.length}`;
    }
    const rows: any[] = await this.dataSource.query(
      `SELECT id, cheque_number, type, status, due_date::text AS due_date, amount, drawer, bank_name
         FROM cheques
        WHERE tenant_id = $1
          AND ((type = 'received' AND status IN ('in_portfolio', 'under_collection'))
               OR (type = 'issued' AND status = 'issued'))
          AND due_date <= $2::date ${typeFilter}
        ORDER BY due_date, cheque_number
        LIMIT 500`,
      params,
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${r.type === 'issued' ? 'OUT' : 'IN'} #${r.cheque_number} ${r.due_date} ${money(r.amount)}${r.drawer ? ` ${r.drawer}` : ''}`,
      data: { id: r.id, chequeNumber: r.cheque_number, type: r.type, status: r.status, dueDate: r.due_date, amount: Number(r.amount), bank: r.bank_name },
    }));
  }

  private async chequesBounced(q: AlertQuery): Promise<AlertMatch[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT id, cheque_number, type, amount, drawer, COALESCE(status_date, updated_at::date)::text AS bounced_on
         FROM cheques
        WHERE tenant_id = $1 AND status = 'bounced'
          AND COALESCE(status_date, updated_at::date) >= $2::date
        ORDER BY bounced_on DESC
        LIMIT 500`,
      [q.tenantId, addDays(q.asOf, -q.days)],
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `#${r.cheque_number} ${r.bounced_on} ${money(r.amount)}${r.drawer ? ` ${r.drawer}` : ''}`,
      data: { id: r.id, chequeNumber: r.cheque_number, type: r.type, bouncedOn: r.bounced_on, amount: Number(r.amount) },
    }));
  }

  private async overdueInvoices(q: AlertQuery): Promise<AlertMatch[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT si.id, si.invoice_number, si.due_date::text AS due_date, si.total_amount - si.paid_amount AS residual,
              c.code AS customer_code, c.name_ar AS customer_name
         FROM sales_invoices si
         JOIN customers c ON c.id = si.customer_id
        WHERE si.tenant_id = $1
          AND si.move_type = 'invoice'
          AND si.status IN ('posted', 'sent', 'partial', 'overdue')
          AND si.due_date < $2::date
          AND si.total_amount - si.paid_amount > $3
        ORDER BY si.due_date
        LIMIT 500`,
      [q.tenantId, addDays(q.asOf, -q.days), Math.max(Number(q.params.minAmount ?? 0), 0.005)],
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${r.invoice_number} ${r.customer_code} ${r.due_date} ${money(r.residual)}`,
      data: { id: r.id, invoiceNumber: r.invoice_number, customer: r.customer_code, customerName: r.customer_name, dueDate: r.due_date, residual: Number(r.residual) },
    }));
  }

  private async overdueInstallments(q: AlertQuery): Promise<AlertMatch[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT i.id, i.sequence, i.due_date::text AS due_date, i.amount - i.paid_amount AS residual,
              p.plan_number, c.code AS customer_code, c.name_ar AS customer_name
         FROM installments i
         JOIN installment_plans p ON p.id = i.plan_id
         JOIN customers c ON c.id = p.customer_id
        WHERE p.tenant_id = $1
          AND p.status = 'active'
          AND i.status IN ('due', 'partial', 'overdue')
          AND i.due_date < $2::date
          AND i.amount - i.paid_amount > 0.005
        ORDER BY i.due_date
        LIMIT 500`,
      [q.tenantId, addDays(q.asOf, -q.days)],
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${r.plan_number}/${r.sequence} ${r.customer_code} ${r.due_date} ${money(r.residual)}`,
      data: { id: r.id, planNumber: r.plan_number, sequence: r.sequence, customer: r.customer_code, customerName: r.customer_name, dueDate: r.due_date, residual: Number(r.residual) },
    }));
  }

  private async supplierBillsDue(q: AlertQuery): Promise<AlertMatch[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT pi.id, pi.invoice_number, pi.supplier_reference, pi.due_date::text AS due_date,
              pi.total_amount - pi.paid_amount AS residual, s.code AS supplier_code, s.name_ar AS supplier_name
         FROM purchase_invoices pi
         JOIN suppliers s ON s.id = pi.supplier_id
        WHERE pi.tenant_id = $1
          AND pi.move_type = 'bill'
          AND pi.status IN ('approved', 'partial', 'overdue')
          AND pi.due_date <= $2::date
          AND pi.total_amount - pi.paid_amount > 0.005
        ORDER BY pi.due_date
        LIMIT 500`,
      [q.tenantId, addDays(q.asOf, q.days)],
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${r.invoice_number} ${r.supplier_code} ${r.due_date} ${money(r.residual)}`,
      data: { id: r.id, invoiceNumber: r.invoice_number, supplierReference: r.supplier_reference, supplier: r.supplier_code, supplierName: r.supplier_name, dueDate: r.due_date, residual: Number(r.residual) },
    }));
  }

  private async lots(q: AlertQuery, expired: boolean): Promise<AlertMatch[]> {
    const condition = expired
      ? `l.expiry_date < $2::date`
      : `l.expiry_date >= $2::date AND l.expiry_date <= $3::date`;
    const params = expired ? [q.tenantId, q.asOf] : [q.tenantId, q.asOf, addDays(q.asOf, q.days)];
    const rows: any[] = await this.dataSource.query(
      `SELECT l.id, l.lot_number, l.expiry_date::text AS expiry_date, l.quantity,
              p.code AS product_code, p.name_ar AS product_name, w.code AS warehouse_code
         FROM stock_lots l
         JOIN products p ON p.id = l.product_id
         JOIN warehouses w ON w.id = l.warehouse_id
        WHERE l.tenant_id = $1 AND l.quantity > 0 AND l.expiry_date IS NOT NULL AND ${condition}
        ORDER BY l.expiry_date
        LIMIT 500`,
      params,
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${r.product_code} ${r.lot_number} @${r.warehouse_code} ${r.expiry_date} x${Number(r.quantity)}`,
      data: { id: r.id, product: r.product_code, productName: r.product_name, lotNumber: r.lot_number, warehouse: r.warehouse_code, expiryDate: r.expiry_date, quantity: Number(r.quantity) },
    }));
  }

  private async lowStock(q: AlertQuery): Promise<AlertMatch[]> {
    const params: unknown[] = [q.tenantId];
    let warehouseFilter = '';
    if (typeof q.params.warehouseId === 'string' && /^[0-9a-f-]{36}$/i.test(q.params.warehouseId)) {
      params.push(q.params.warehouseId);
      warehouseFilter = `AND s.warehouse_id = $2`;
    }
    const rows: any[] = await this.dataSource.query(
      `SELECT p.id, p.code, p.name_ar, p.reorder_level, p.reorder_qty,
              COALESCE(SUM(s.quantity - s.reserved_qty), 0) AS available
         FROM products p
         LEFT JOIN stocks s ON s.product_id = p.id AND s.tenant_id = p.tenant_id ${warehouseFilter}
        WHERE p.tenant_id = $1 AND p.is_active = true AND p.type = 'goods' AND p.reorder_level > 0
        GROUP BY p.id
       HAVING COALESCE(SUM(s.quantity - s.reserved_qty), 0) <= p.reorder_level
        ORDER BY p.code
        LIMIT 500`,
      params,
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${r.code} ${Number(r.available)}/${Number(r.reorder_level)}`,
      data: { id: r.id, product: r.code, productName: r.name_ar, available: Number(r.available), reorderLevel: Number(r.reorder_level), reorderQty: Number(r.reorder_qty) },
    }));
  }

  private async payrollNotRun(q: AlertQuery): Promise<AlertMatch[]> {
    const { period, end } = payrollPeriodToCheck(q.asOf, q.days || 25);
    const rows: { employees: string; runs: string }[] = await this.dataSource.query(
      `SELECT
         (SELECT COUNT(*) FROM hr_employees
           WHERE tenant_id = $1 AND status = 'active' AND hire_date <= $3::date) AS employees,
         (SELECT COUNT(*) FROM hr_payroll_runs
           WHERE tenant_id = $1 AND period = $2 AND status NOT IN ('cancelled', 'reversed')) AS runs`,
      [q.tenantId, period, end],
    );
    const employees = Number(rows[0]?.employees ?? 0);
    if (!employees || Number(rows[0]?.runs ?? 0) > 0) return [];
    return [{ recordKey: `payroll:${period}`, label: `${period} (${employees})`, data: { period, activeEmployees: employees } }];
  }

  private async periodNotLocked(q: AlertQuery): Promise<AlertMatch[]> {
    const rows: { lock_date: string | null }[] = await this.dataSource.query(
      `SELECT lock_date::text AS lock_date FROM accounting_settings WHERE tenant_id = $1`,
      [q.tenantId],
    );
    if (!rows.length) return [];
    const expected = expectedLockDate(q.asOf, q.days);
    const lock = rows[0].lock_date;
    if (lock && lock >= expected) return [];
    return [
      {
        recordKey: `lock:${expected.slice(0, 7)}`,
        label: `${expected.slice(0, 7)} (lock date ${lock ?? '-'})`,
        data: { expectedLockDate: expected, lockDate: lock },
      },
    ];
  }

  private async einvoicesRejected(q: AlertQuery): Promise<AlertMatch[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT id, provider, internal_id, status, document_date::text AS document_date, last_error, total_amount
         FROM e_invoices
        WHERE tenant_id = $1 AND status IN ('invalid', 'rejected', 'failed')
          AND updated_at >= $2::date
        ORDER BY updated_at DESC
        LIMIT 500`,
      [q.tenantId, addDays(q.asOf, -q.days)],
    );
    return rows.map((r) => ({
      recordKey: r.id,
      label: `${String(r.provider).toUpperCase()} ${r.internal_id ?? r.id.slice(0, 8)} ${r.status}`,
      data: { id: r.id, provider: r.provider, internalId: r.internal_id, status: r.status, documentDate: r.document_date, error: r.last_error, total: Number(r.total_amount) },
    }));
  }

  private async posSessionsOpen(q: AlertQuery): Promise<AlertMatch[]> {
    const since = new Date(q.now.getTime() - q.hours * 3600 * 1000);
    const rows: any[] = await this.dataSource.query(
      `SELECT s.id, s.opened_at, t.name AS terminal, u.name AS cashier
         FROM pos_sessions s
         LEFT JOIN pos_terminals t ON t.id = s.terminal_id
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.tenant_id = $1 AND s.status = 'open' AND s.opened_at < $2
        ORDER BY s.opened_at
        LIMIT 500`,
      [q.tenantId, since],
    );
    return rows.map((r) => {
      const opened = new Date(r.opened_at);
      const hours = Math.floor((q.now.getTime() - opened.getTime()) / 3600000);
      return {
        recordKey: r.id,
        label: `${r.terminal ?? '-'} ${r.cashier ?? ''} ${hours}h`.replace(/\s+/g, ' '),
        data: { id: r.id, terminal: r.terminal, cashier: r.cashier, openedAt: opened.toISOString(), hoursOpen: hours },
      };
    });
  }
}
