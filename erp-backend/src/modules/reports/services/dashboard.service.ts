import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, In } from 'typeorm';
import { SalesInvoice, SalesInvoiceStatus } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice, PurchaseInvoiceStatus } from '@modules/purchasing/entities/purchase-invoice.entity';
import { SalesOrder, SalesOrderStatus } from '@modules/sales/entities/sales-order.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Notification } from '@modules/notifications/entities/notification.entity';
import { AccountingSettings } from '@modules/accounting/entities/accounting-settings.entity';
import { round } from '@shared/utils/document-totals.util';
import { ManagementReportsService } from './management-reports.service';
import { SalesAnalysisService } from './sales-analysis.service';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(SalesInvoice)
    private readonly salesInvoiceRepo: Repository<SalesInvoice>,
    @InjectRepository(PurchaseInvoice)
    private readonly purchaseInvoiceRepo: Repository<PurchaseInvoice>,
    @InjectRepository(SalesOrder)
    private readonly salesOrderRepo: Repository<SalesOrder>,
    @InjectRepository(Stock)
    private readonly stockRepo: Repository<Stock>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(AccountingSettings)
    private readonly settingsRepo: Repository<AccountingSettings>,
    private readonly managementReports: ManagementReportsService,
    private readonly salesAnalysis: SalesAnalysisService,
  ) {}

  async getDashboard(tenantId: string, userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const today = now.toISOString().split('T')[0];

    // Revenue this month: untaxed amount of posted invoices net of credit notes
    const revenueResult = await this.salesInvoiceRepo
      .createQueryBuilder('inv')
      .select(
        `COALESCE(SUM(CASE WHEN inv.moveType = 'credit_note' THEN -inv.subtotal ELSE inv.subtotal END), 0)`,
        'total',
      )
      .where('inv.tenantId = :tenantId', { tenantId })
      .andWhere('inv.status NOT IN (:...excluded)', {
        excluded: [SalesInvoiceStatus.DRAFT, SalesInvoiceStatus.CANCELLED],
      })
      .andWhere('inv.date >= :from', { from: startOfMonth })
      .andWhere('inv.date <= :to', { to: today })
      .getRawOne();

    // Expenses this month: untaxed amount of approved bills net of vendor refunds
    const expensesResult = await this.purchaseInvoiceRepo
      .createQueryBuilder('inv')
      .select(
        `COALESCE(SUM(CASE WHEN inv.moveType = 'refund' THEN -inv.subtotal ELSE inv.subtotal END), 0)`,
        'total',
      )
      .where('inv.tenantId = :tenantId', { tenantId })
      .andWhere('inv.status NOT IN (:...excluded)', {
        excluded: [PurchaseInvoiceStatus.DRAFT, PurchaseInvoiceStatus.CANCELLED],
      })
      .andWhere('inv.date >= :from', { from: startOfMonth })
      .andWhere('inv.date <= :to', { to: today })
      .getRawOne();

    // Pending orders count
    const pendingOrders = await this.salesOrderRepo.count({
      where: {
        tenantId,
        status: In([SalesOrderStatus.DRAFT, SalesOrderStatus.SENT, SalesOrderStatus.CONFIRMED]),
      },
    });

    // Low stock products
    const lowStockProducts = await this.getLowStockCount(tenantId);

    // Recent orders
    const recentOrders = await this.salesOrderRepo.find({
      where: { tenantId },
      relations: ['customer'],
      order: { createdAt: 'DESC' },
      take: 5,
    });

    // Recent notifications
    const recentNotifications = await this.notificationRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    const totalRevenue = Number(revenueResult?.total) || 0;
    const totalExpenses = Number(expensesResult?.total) || 0;

    // Sequential: the request runs on a single transactional connection
    const receivables = await this.managementReports.getAgedReceivables(tenantId, today);
    const payables = await this.managementReports.getAgedPayables(tenantId, today);
    const cashAndBank = await this.getCashAndBank(tenantId);
    const topProducts = (
      await this.salesAnalysis.salesAnalysis(tenantId, {
        from: startOfMonth,
        to: today,
        groupBy: 'product',
        limit: 5,
      })
    ).rows;
    const overdue = (totals: Record<string, number>) =>
      round(Object.entries(totals).reduce((s, [k, v]) => (k === 'current' ? s : s + v), 0), 4);

    return {
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      pendingOrders,
      lowStockProducts,
      lowStockCount: lowStockProducts,
      receivables: {
        total: receivables.total,
        overdue: overdue(receivables.totals),
        buckets: receivables.totals,
      },
      payables: {
        total: payables.total,
        overdue: overdue(payables.totals),
        buckets: payables.totals,
      },
      cash: cashAndBank.cash,
      bank: cashAndBank.bank,
      topProducts: topProducts.map((p) => ({
        productId: p.key,
        code: p.code,
        name: p.name,
        quantity: p.quantity,
        net: p.net,
        grossProfit: p.grossProfit,
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customer?.nameAr || o.customer?.nameEn || '',
        totalAmount: Number(o.totalAmount),
        status: o.status,
        date: o.date,
      })),
      recentNotifications: recentNotifications.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        type: n.type,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
    };
  }

  /** Active products whose total on-hand quantity is at or below their reorder level. */
  private async getLowStockCount(tenantId: string): Promise<number> {
    const rows: { count: string }[] = await this.productRepo.query(
      `SELECT COUNT(*) AS count FROM (
         SELECT p.id
           FROM products p
           LEFT JOIN stocks s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1 AND p.is_active = true AND p.reorder_level > 0
          GROUP BY p.id, p.reorder_level
         HAVING COALESCE(SUM(s.quantity), 0) <= p.reorder_level
       ) low`,
      [tenantId],
    );
    return Number(rows[0]?.count) || 0;
  }

  /**
   * Ledger balances of the default cash and bank accounts and of their
   * sibling postable accounts (other cash boxes and bank accounts).
   */
  private async getCashAndBank(tenantId: string) {
    const settings = await this.settingsRepo.findOne({ where: { tenantId } });
    const empty = { balance: 0, accounts: [] as { accountId: string; code: string; name: string; balance: number }[] };
    if (!settings?.cashAccountId && !settings?.bankAccountId) return { cash: empty, bank: empty };

    const balances = async (accountId?: string) => {
      if (!accountId) return empty;
      const rows: { accountId: string; code: string; nameAr: string; nameEn: string; balance: string }[] =
        await this.productRepo.query(
          `SELECT a.id AS "accountId", a.code, a.name_ar AS "nameAr", a.name_en AS "nameEn",
                  COALESCE(SUM(CASE WHEN e.id IS NULL THEN 0 ELSE l.debit - l.credit END), 0) AS balance
             FROM accounts a
             JOIN accounts d ON d.id = $2 AND d.tenant_id = a.tenant_id
             LEFT JOIN journal_lines l ON l.account_id = a.id
             LEFT JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
            WHERE a.tenant_id = $1 AND a.allow_posting = true
              AND (a.id = d.id OR (d.parent_id IS NOT NULL AND a.parent_id = d.parent_id AND a.type = d.type))
            GROUP BY a.id, a.code, a.name_ar, a.name_en
            ORDER BY a.code`,
          [tenantId, accountId],
        );
      const accounts = rows.map((r) => ({
        accountId: r.accountId,
        code: r.code,
        name: r.nameEn || r.nameAr,
        balance: round(Number(r.balance), 4),
      }));
      return { balance: round(accounts.reduce((s, a) => s + a.balance, 0), 4), accounts };
    };

    // With both defaults under the same parent, report each account once (as bank unless it is the cash one)
    const cash = await balances(settings.cashAccountId);
    const bank = await balances(settings.bankAccountId);
    if (cash.accounts.length && bank.accounts.length) {
      const cashOnly = cash.accounts.filter(
        (a) => a.accountId === settings.cashAccountId || !/bank|بنك/i.test(a.name),
      );
      const bankOnly = bank.accounts.filter(
        (a) => a.accountId !== settings.cashAccountId && !cashOnly.some((c) => c.accountId === a.accountId),
      );
      return {
        cash: { balance: round(cashOnly.reduce((s, a) => s + a.balance, 0), 4), accounts: cashOnly },
        bank: { balance: round(bankOnly.reduce((s, a) => s + a.balance, 0), 4), accounts: bankOnly },
      };
    }
    return { cash, bank };
  }
}
