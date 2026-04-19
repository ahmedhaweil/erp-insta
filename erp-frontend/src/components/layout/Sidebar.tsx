'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { clsx } from 'clsx';
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
  ChevronDown,
  BarChart3,
} from 'lucide-react';
import { useState } from 'react';

interface NavGroup {
  key: string;
  icon: React.ReactNode;
  items: { key: string; href: string }[];
}

export default function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<string[]>(['dashboard']);

  const navGroups: NavGroup[] = [
    {
      key: 'dashboard',
      icon: <LayoutDashboard size={20} />,
      items: [{ key: 'dashboard', href: '/' }],
    },
    {
      key: 'accounting',
      icon: <BookOpen size={20} />,
      items: [
        { key: 'chartOfAccounts', href: '/accounting/accounts' },
        { key: 'journalEntries', href: '/accounting/journal-entries' },
      ],
    },
    {
      key: 'inventory',
      icon: <Package size={20} />,
      items: [
        { key: 'products', href: '/inventory/products' },
        { key: 'warehouses', href: '/inventory/warehouses' },
        { key: 'stockMovements', href: '/inventory/stock' },
      ],
    },
    {
      key: 'sales',
      icon: <ShoppingCart size={20} />,
      items: [
        { key: 'customers', href: '/sales/customers' },
        { key: 'salesOrders', href: '/sales/orders' },
        { key: 'salesInvoices', href: '/sales/invoices' },
      ],
    },
    {
      key: 'purchasing',
      icon: <Truck size={20} />,
      items: [
        { key: 'suppliers', href: '/purchasing/suppliers' },
        { key: 'purchaseOrders', href: '/purchasing/orders' },
        { key: 'purchaseInvoices', href: '/purchasing/invoices' },
      ],
    },
    {
      key: 'pos',
      icon: <Monitor size={20} />,
      items: [{ key: 'pos', href: '/pos' }],
    },
    {
      key: 'compliance',
      icon: <Shield size={20} />,
      items: [
        { key: 'taxConfig', href: '/compliance/tax-config' },
        { key: 'eInvoices', href: '/compliance/e-invoices' },
      ],
    },
    {
      key: 'reports',
      icon: <BarChart3 size={20} />,
      items: [
        { key: 'trialBalance', href: '/reports/trial-balance' },
        { key: 'profitLoss', href: '/reports/profit-loss' },
        { key: 'balanceSheet', href: '/reports/balance-sheet' },
      ],
    },
    {
      key: 'notifications',
      icon: <Bell size={20} />,
      items: [{ key: 'notifications', href: '/notifications' }],
    },
    {
      key: 'settings',
      icon: <Settings size={20} />,
      items: [{ key: 'settings', href: '/settings' }],
    },
  ];

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  return (
    <aside className="w-64 bg-sidebar text-white min-h-screen flex-shrink-0">
      <div className="p-4 border-b border-white/10">
        <h1 className="text-lg font-bold">ERP System</h1>
      </div>
      <nav className="p-2 space-y-1">
        {navGroups.map((group) => {
          const isOpen = openGroups.includes(group.key);
          const hasMultipleItems = group.items.length > 1;

          if (!hasMultipleItems) {
            const item = group.items[0];
            const isActive = pathname.endsWith(item.href) || (item.href === '/' && pathname.match(/\/[a-z]{2}$/));
            return (
              <Link
                key={group.key}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition',
                  isActive
                    ? 'bg-sidebar-active text-white'
                    : 'text-gray-300 hover:bg-sidebar-hover hover:text-white',
                )}
              >
                {group.icon}
                <span>{t(item.key)}</span>
              </Link>
            );
          }

          return (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group.key)}
                className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-sidebar-hover hover:text-white transition"
              >
                <span className="flex items-center gap-3">
                  {group.icon}
                  <span>{t(group.key)}</span>
                </span>
                <ChevronDown
                  size={16}
                  className={clsx('transition-transform', isOpen && 'rotate-180')}
                />
              </button>
              {isOpen && (
                <div className="ms-8 mt-1 space-y-1">
                  {group.items.map((item) => {
                    const isActive = pathname.includes(item.href);
                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        className={clsx(
                          'block px-3 py-2 rounded-lg text-sm transition',
                          isActive
                            ? 'bg-sidebar-active text-white'
                            : 'text-gray-400 hover:bg-sidebar-hover hover:text-white',
                        )}
                      >
                        {t(item.key)}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
