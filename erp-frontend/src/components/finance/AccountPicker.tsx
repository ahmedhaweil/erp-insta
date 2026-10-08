'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, X } from 'lucide-react';
import { useFinAccounts } from '@/hooks/use-finance';
import type { AccountType, FinAccount } from '@/services/finance-accounting.service';
import { inputCls, useLocalName } from './ui';

/**
 * Searchable account picker (code or Arabic / English name). By default only
 * postable (leaf) active accounts can be chosen.
 */
export default function AccountPicker({
  value,
  onChange,
  postableOnly = true,
  types,
  placeholder,
  disabled,
  allowClear = true,
}: {
  value?: string | null;
  onChange: (id: string) => void;
  postableOnly?: boolean;
  types?: AccountType[];
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const t = useTranslations('fin');
  const name = useLocalName();
  const { data: accounts = [] } = useFinAccounts();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = accounts.find((a) => a.id === value);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => a.isActive !== false)
      .filter((a) => !postableOnly || a.allowPosting)
      .filter((a) => !types || types.includes(a.type))
      .filter(
        (a) =>
          !q ||
          a.code.toLowerCase().startsWith(q) ||
          a.nameAr.toLowerCase().includes(q) ||
          (a.nameEn ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .slice(0, 80);
  }, [accounts, query, postableOnly, types]);

  const label = (a: FinAccount) => `${a.code} - ${name(a)}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`${inputCls} flex items-center justify-between text-start`}
      >
        <span className={selected ? 'truncate' : 'truncate text-gray-400'}>
          {selected ? label(selected) : placeholder || t('selectAccount')}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {allowClear && selected && !disabled && (
            <X
              size={14}
              className="text-gray-400 hover:text-gray-700"
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
            />
          )}
          <ChevronDown size={14} className="text-gray-400" />
        </span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-[18rem] bg-white border border-gray-200 rounded-lg shadow-lg">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchAccount')}
            className="w-full px-3 py-2 text-sm border-b border-gray-200 outline-none rounded-t-lg"
          />
          <ul className="max-h-60 overflow-y-auto py-1">
            {options.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">{t('noResults')}</li>}
            {options.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(a.id);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`w-full text-start px-3 py-1.5 text-sm hover:bg-primary-50 ${
                    a.id === value ? 'bg-primary-50 text-primary-700' : ''
                  } ${a.allowPosting ? '' : 'font-semibold text-gray-600'}`}
                  style={{ paddingInlineStart: `${0.75 + Math.min(a.level ?? 0, 4) * 0.5}rem` }}
                >
                  <span className="tabular-nums text-gray-500">{a.code}</span> {name(a)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Formats an account id as "code - name" using the cached accounts list. */
export function useAccountLabel() {
  const { data: accounts = [] } = useFinAccounts();
  const name = useLocalName();
  return (id?: string | null) => {
    if (!id) return '';
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.code} - ${name(a)}` : id.slice(0, 8);
  };
}
