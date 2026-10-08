/**
 * Raw-SQL building blocks for ledger reports (journal_lines `l` joined to
 * journal_entries `e`).
 *
 * Branch of a journal line: the line's own branch, otherwise the branch of the
 * business document that generated the entry (sales/purchase invoice, sales
 * order delivery, POS order through its terminal). Automatic postings do not
 * stamp branches on lines, so this keeps branch filters meaningful.
 */
export const BRANCH_JOINS = `
  LEFT JOIN sales_invoices br_si
    ON e.source_type IN ('sales_invoice', 'sales_invoice_payment') AND br_si.id = e.source_id
  LEFT JOIN purchase_invoices br_pi
    ON e.source_type IN ('purchase_invoice', 'purchase_invoice_payment') AND br_pi.id = e.source_id
  LEFT JOIN sales_orders br_so
    ON e.source_type = 'sales_delivery' AND br_so.id = e.source_id
  LEFT JOIN pos_orders br_po ON e.source_type = 'pos_order' AND br_po.id = e.source_id
  LEFT JOIN pos_sessions br_ps ON br_ps.id = br_po.session_id
  LEFT JOIN pos_terminals br_pt ON br_pt.id = br_ps.terminal_id`;

export const BRANCH_EXPR = `COALESCE(l.branch_id, br_si.branch_id, br_pi.branch_id, br_so.branch_id, br_pt.branch_id)`;

/** Positional parameter collector for pg ($1, $2...). */
export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface LedgerFilter {
  tenantId: string;
  /** Inclusive lower bound. */
  from?: string;
  /** Inclusive upper bound. */
  to?: string;
  /** Exclusive upper bound (for opening balances). */
  before?: string;
  branchId?: string;
  costCenterId?: string;
  accountIds?: string[];
  excludeClosing?: boolean;
}

/** WHERE clause for posted lines matching the filter. */
export function ledgerWhere(p: SqlParams, f: LedgerFilter): string {
  const parts = [`e.tenant_id = ${p.add(f.tenantId)}`, `e.status = 'posted'`];
  if (f.from) parts.push(`e.date >= ${p.add(f.from)}`);
  if (f.to) parts.push(`e.date <= ${p.add(f.to)}`);
  if (f.before) parts.push(`e.date < ${p.add(f.before)}`);
  if (f.costCenterId) parts.push(`l.cost_center_id = ${p.add(f.costCenterId)}`);
  if (f.branchId) parts.push(`${BRANCH_EXPR} = ${p.add(f.branchId)}`);
  if (f.accountIds) parts.push(`l.account_id = ANY(${p.add(f.accountIds)}::uuid[])`);
  if (f.excludeClosing) {
    parts.push(`(e.source_type IS NULL OR e.source_type <> 'fiscal_year_closing')`);
  }
  return parts.join(' AND ');
}

/** The branch joins are only needed when the query filters or groups by branch. */
export function needsBranchJoins(f: LedgerFilter, groupByBranch = false): boolean {
  return groupByBranch || !!f.branchId;
}

/** Previous calendar day of a YYYY-MM-DD date. */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
