'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { buildNav } from './nav';

const navGroups = buildNav();

export default function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [openGroups, setOpenGroups] = useState<string[]>(['dashboard']);

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
                <group.icon size={20} />
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
                  <group.icon size={20} />
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
