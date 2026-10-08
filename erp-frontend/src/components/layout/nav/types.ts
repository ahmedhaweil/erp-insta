import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  /** Translation key in the "nav" namespace. */
  key: string;
  href: string;
}

export interface NavGroup {
  /** Translation key in the "nav" namespace; also the group id. */
  key: string;
  icon: LucideIcon;
  items: NavItem[];
  /** Lower comes first; core groups use multiples of 10. */
  order: number;
}
