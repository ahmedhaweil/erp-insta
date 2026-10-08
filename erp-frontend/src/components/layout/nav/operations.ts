import { Package, ShoppingCart, Truck, Monitor, Shield } from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Navigation contributed by the operations area. Items added to a group key that
 * already exists (e.g. 'sales') are appended to that group.
 */
export const operationsNav: NavGroup[] = [
  {
    key: 'inventory',
    icon: Package,
    order: 30,
    items: [
      { key: 'products', href: '/inventory/products' },
      { key: 'productCategories', href: '/inventory/categories' },
      { key: 'warehouses', href: '/inventory/warehouses' },
      { key: 'stockMovements', href: '/inventory/stock' },
      { key: 'stockTransfers', href: '/inventory/transfers' },
      { key: 'stockCounts', href: '/inventory/stock-counts' },
      { key: 'lots', href: '/inventory/lots' },
      { key: 'itemCard', href: '/inventory/item-card' },
      { key: 'inventoryReports', href: '/inventory/reports' },
      { key: 'inventorySettings', href: '/inventory/settings' },
    ],
  },
  {
    key: 'sales',
    icon: ShoppingCart,
    order: 40,
    items: [
      { key: 'customers', href: '/sales/customers' },
      { key: 'customerCategories', href: '/sales/customer-categories' },
      { key: 'priceLists', href: '/sales/price-lists' },
      { key: 'salesReps', href: '/sales/reps' },
      { key: 'salesOrders', href: '/sales/orders' },
      { key: 'salesInvoices', href: '/sales/invoices' },
      { key: 'salesReturns', href: '/sales/returns' },
      { key: 'installments', href: '/sales/installments' },
    ],
  },
  {
    key: 'purchasing',
    icon: Truck,
    order: 50,
    items: [
      { key: 'suppliers', href: '/purchasing/suppliers' },
      { key: 'requisitions', href: '/purchasing/requisitions' },
      { key: 'purchaseOrders', href: '/purchasing/orders' },
      { key: 'purchaseInvoices', href: '/purchasing/invoices' },
      { key: 'purchaseReturns', href: '/purchasing/returns' },
      { key: 'replenishment', href: '/purchasing/replenishment' },
      { key: 'purchasingSettings', href: '/purchasing/settings' },
    ],
  },
  {
    key: 'pos',
    icon: Monitor,
    order: 60,
    items: [
      { key: 'posTill', href: '/pos' },
      { key: 'posTerminals', href: '/pos/terminals' },
    ],
  },
  {
    key: 'compliance',
    icon: Shield,
    order: 90,
    items: [
      { key: 'complianceSettings', href: '/compliance/settings' },
      { key: 'taxConfig', href: '/compliance/tax-config' },
      { key: 'itemCodes', href: '/compliance/item-codes' },
      { key: 'taxProfiles', href: '/compliance/tax-profiles' },
      { key: 'eInvoices', href: '/compliance/e-invoices' },
      { key: 'eReceipts', href: '/compliance/e-receipts' },
    ],
  },
];
