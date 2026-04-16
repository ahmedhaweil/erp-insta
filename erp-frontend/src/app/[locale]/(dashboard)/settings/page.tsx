'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { Globe, Building2, Users, Shield } from 'lucide-react';

export default function SettingsPage() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale as any });
  };

  const sections = [
    {
      icon: <Globe size={20} />,
      title: t('language'),
      content: (
        <div className="flex gap-3">
          <button
            onClick={() => switchLocale('ar')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              locale === 'ar' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t('arabic')}
          </button>
          <button
            onClick={() => switchLocale('en')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              locale === 'en' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {t('english')}
          </button>
        </div>
      ),
    },
    { icon: <Building2 size={20} />, title: t('company'), content: <p className="text-sm text-gray-500">{t('general')}</p> },
    { icon: <Users size={20} />, title: t('users'), content: <p className="text-sm text-gray-500">{t('roles')}</p> },
    { icon: <Shield size={20} />, title: t('roles'), content: <p className="text-sm text-gray-500">{t('general')}</p> },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h1>
      <div className="space-y-4">
        {sections.map((section, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="text-gray-600">{section.icon}</div>
              <h2 className="text-lg font-semibold text-gray-900">{section.title}</h2>
            </div>
            {section.content}
          </div>
        ))}
      </div>
    </div>
  );
}
