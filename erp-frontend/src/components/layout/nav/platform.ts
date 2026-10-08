import { CheckSquare, Settings, Users } from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Cross-cutting screens: approvals, data import / export, alert rules and the
 * employee self-service area. Items added to an existing group key are
 * appended to that group.
 */
export const platformNav: NavGroup[] = [
  {
    key: 'approvals',
    icon: CheckSquare,
    order: 105,
    items: [
      { key: 'approvalInbox', href: '/approvals/requests' },
      { key: 'approvalRules', href: '/approvals/rules' },
    ],
  },
  {
    key: 'hr',
    icon: Users,
    order: 75,
    items: [{ key: 'hrSelfService', href: '/hr/me' }],
  },
  {
    key: 'settings',
    icon: Settings,
    order: 110,
    items: [
      { key: 'dataImport', href: '/settings/import' },
      { key: 'alertRules', href: '/settings/alerts' },
    ],
  },
];
