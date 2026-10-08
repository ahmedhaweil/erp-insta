import {
  LayoutDashboard,
  BookOpen,
  Package,
  ShoppingCart,
  Truck,
  Monitor,
  Shield,
  Bell,
  Settings,
} from 'lucide-react';
import type { NavGroup } from './types';

export const coreNav: NavGroup[] = [
  { key: 'dashboard', icon: LayoutDashboard, order: 0, items: [{ key: 'dashboard', href: '/' }] },
  {
    key: 'accounting',
    icon: BookOpen,
    order: 10,
    items: [
      { key: 'chartOfAccounts', href: '/accounting/accounts' },
      { key: 'journalEntries', href: '/accounting/journal-entries' },
    ],
  },
  {
    key: 'inventory',
    icon: Package,
    order: 30,
    items: [
      { key: 'products', href: '/inventory/products' },
      { key: 'warehouses', href: '/inventory/warehouses' },
      { key: 'stockMovements', href: '/inventory/stock' },
    ],
  },
  {
    key: 'sales',
    icon: ShoppingCart,
    order: 40,
    items: [
      { key: 'customers', href: '/sales/customers' },
      { key: 'salesOrders', href: '/sales/orders' },
      { key: 'salesInvoices', href: '/sales/invoices' },
    ],
  },
  {
    key: 'purchasing',
    icon: Truck,
    order: 50,
    items: [
      { key: 'suppliers', href: '/purchasing/suppliers' },
      { key: 'purchaseOrders', href: '/purchasing/orders' },
      { key: 'purchaseInvoices', href: '/purchasing/invoices' },
    ],
  },
  { key: 'pos', icon: Monitor, order: 60, items: [{ key: 'pos', href: '/pos' }] },
  {
    key: 'compliance',
    icon: Shield,
    order: 90,
    items: [
      { key: 'taxConfig', href: '/compliance/tax-config' },
      { key: 'eInvoices', href: '/compliance/e-invoices' },
    ],
  },
  { key: 'notifications', icon: Bell, order: 100, items: [{ key: 'notifications', href: '/notifications' }] },
  { key: 'settings', icon: Settings, order: 110, items: [{ key: 'settings', href: '/settings' }] },
];
