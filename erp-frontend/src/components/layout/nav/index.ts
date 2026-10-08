import { coreNav } from './core';
import { financeNav } from './finance';
import { operationsNav } from './operations';
import { peopleNav } from './people';
import { platformNav } from './platform';
import type { NavGroup } from './types';

export type { NavGroup, NavItem } from './types';

/** All navigation groups, merged by key (later areas append items) and sorted. */
export function buildNav(): NavGroup[] {
  const groups = new Map<string, NavGroup>();
  for (const group of [...coreNav, ...financeNav, ...operationsNav, ...peopleNav, ...platformNav]) {
    const existing = groups.get(group.key);
    if (existing) {
      const known = new Set(existing.items.map((i) => i.href));
      existing.items.push(...group.items.filter((i) => !known.has(i.href)));
    } else {
      groups.set(group.key, { ...group, items: [...group.items] });
    }
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}
