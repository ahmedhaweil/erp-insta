'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname, Link } from '@/i18n/navigation';
import { Globe, Building2, Users, Shield, ScrollText, UserCircle, GitBranch, BookOpen, Calculator, Upload, BellRing, CheckSquare } from 'lucide-react';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const ta = useTranslations('admin');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale as any });
  };

  const links = [
    { href: '/settings/company', icon: Building2, title: ta('companyTitle'), desc: ta('companyDesc') },
    { href: '/settings/branches', icon: GitBranch, title: ta('branchesTitle'), desc: ta('branchesDesc') },
    { href: '/settings/users', icon: Users, title: ta('usersTitle'), desc: ta('usersDesc') },
    { href: '/settings/roles', icon: Shield, title: ta('rolesTitle'), desc: ta('rolesDesc') },
    { href: '/settings/audit-log', icon: ScrollText, title: ta('auditTitle'), desc: ta('auditDesc') },
    { href: '/settings/profile', icon: UserCircle, title: ta('profileTitle'), desc: ta('profileDesc') },
    { href: '/accounting/settings', icon: Calculator, title: ta('accountingSettingsTitle'), desc: ta('accountingSettingsDesc') },
    { href: '/accounting/setup', icon: BookOpen, title: ta('accountingSetupTitle'), desc: ta('accountingSetupDesc') },
    { href: '/settings/import', icon: Upload, title: ta('importTitle'), desc: ta('importDesc') },
    { href: '/settings/alerts', icon: BellRing, title: ta('alertsTitle'), desc: ta('alertsDesc') },
    { href: '/approvals/rules', icon: CheckSquare, title: ta('approvalRulesTitle'), desc: ta('approvalRulesDesc') },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Globe size={20} className="text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">{t('language')}</h2>
        </div>
        <div className="flex gap-3">
          {(['ar', 'en'] as const).map((l) => (
            <button
              key={l}
              onClick={() => switchLocale(l)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                locale === l ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {l === 'ar' ? t('arabic') : t('english')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="bg-white rounded-xl border border-gray-200 p-5 hover:border-primary-400 hover:shadow-sm transition flex gap-4"
          >
            <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
              <l.icon size={20} />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{l.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{l.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
