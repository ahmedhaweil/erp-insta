import { BookOpen, Landmark, BarChart3, Settings } from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Navigation contributed by the finance area. Items added to a group key that
 * already exists (e.g. 'sales') are appended to that group.
 */
export const financeNav: NavGroup[] = [
  {
    key: 'accounting',
    icon: BookOpen,
    order: 10,
    items: [
      { key: 'accountingSetup', href: '/accounting/setup' },
      { key: 'accountingSettings', href: '/accounting/settings' },
      { key: 'fiscalYears', href: '/accounting/fiscal-years' },
      { key: 'fixedAssets', href: '/accounting/fixed-assets' },
      { key: 'budgets', href: '/accounting/budgets' },
    ],
  },
  {
    key: 'treasury',
    icon: Landmark,
    order: 15,
    items: [
      { key: 'treasuries', href: '/treasury/treasuries' },
      { key: 'vouchers', href: '/treasury/vouchers' },
      { key: 'treasuryTransfers', href: '/treasury/transfers' },
      { key: 'payments', href: '/treasury/payments' },
      { key: 'cheques', href: '/treasury/cheques' },
      { key: 'bankStatements', href: '/treasury/bank-statements' },
    ],
  },
  {
    key: 'reports',
    icon: BarChart3,
    order: 70,
    items: [
      { key: 'reportCenter', href: '/reports' },
      { key: 'trialBalance', href: '/reports/trial-balance' },
      { key: 'profitLoss', href: '/reports/profit-loss' },
      { key: 'balanceSheet', href: '/reports/balance-sheet' },
      { key: 'agedReceivables', href: '/reports/aged-receivables' },
    ],
  },
  {
    key: 'settings',
    icon: Settings,
    order: 110,
    items: [
      { key: 'users', href: '/settings/users' },
      { key: 'roles', href: '/settings/roles' },
      { key: 'auditLog', href: '/settings/audit-log' },
      { key: 'myProfile', href: '/settings/profile' },
      { key: 'company', href: '/settings/company' },
      { key: 'branches', href: '/settings/branches' },
    ],
  },
];
