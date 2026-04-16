import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, In } from 'typeorm';
import { SalesInvoice, SalesInvoiceStatus } from '@modules/sales/entities/sales-invoice.entity';
import { PurchaseInvoice, PurchaseInvoiceStatus } from '@modules/purchasing/entities/purchase-invoice.entity';
import { SalesOrder, SalesOrderStatus } from '@modules/sales/entities/sales-order.entity';
import { Stock } from '@modules/inventory/entities/stock.entity';
import { Product } from '@modules/inventory/entities/product.entity';
import { Notification } from '@modules/notifications/entities/notification.entity';

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
  ) {}

  async getDashboard(tenantId: string, userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split('T')[0];
    const today = now.toISOString().split('T')[0];

    // Total revenue this month (paid sales invoices)
    const revenueResult = await this.salesInvoiceRepo
      .createQueryBuilder('inv')
      .select('COALESCE(SUM(inv.totalAmount), 0)', 'total')
      .where('inv.tenantId = :tenantId', { tenantId })
      .andWhere('inv.status = :status', { status: SalesInvoiceStatus.PAID })
      .andWhere('inv.date >= :from', { from: startOfMonth })
      .andWhere('inv.date <= :to', { to: today })
      .getRawOne();

    // Total expenses this month (paid purchase invoices)
    const expensesResult = await this.purchaseInvoiceRepo
      .createQueryBuilder('inv')
      .select('COALESCE(SUM(inv.totalAmount), 0)', 'total')
      .where('inv.tenantId = :tenantId', { tenantId })
      .andWhere('inv.status = :status', { status: PurchaseInvoiceStatus.PAID })
      .andWhere('inv.date >= :from', { from: startOfMonth })
      .andWhere('inv.date <= :to', { to: today })
      .getRawOne();

    // Pending orders count
    const pendingOrders = await this.salesOrderRepo.count({
      where: {
        tenantId,
        status: In([SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED]),
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

    return {
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      pendingOrders,
      lowStockProducts,
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

  private async getLowStockCount(tenantId: string): Promise<number> {
    // Get products with reorder level > 0
    const products = await this.productRepo.find({
      where: { tenantId, isActive: true },
    });

    const productsWithReorder = products.filter(
      (p) => Number(p.reorderLevel) > 0,
    );

    if (productsWithReorder.length === 0) return 0;

    let lowCount = 0;
    for (const product of productsWithReorder) {
      const stocks = await this.stockRepo.find({
        where: { tenantId, productId: product.id },
      });
      const totalQty = stocks.reduce((sum, s) => sum + Number(s.quantity), 0);
      if (totalQty <= Number(product.reorderLevel)) {
        lowCount++;
      }
    }

    return lowCount;
  }
}
