'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { authService } from '@/services/auth.service';
import { Bell, Globe, LogOut, User } from 'lucide-react';

export default function Header() {
  const t = useTranslations('common');
  const ts = useTranslations('settings');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuthStore();

  const switchLocale = () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    router.replace(pathname, { locale: newLocale });
  };

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch {
      // ignore
    }
    logout();
    router.push('/login');
  };

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div />
      <div className="flex items-center gap-4">
        <button
          onClick={switchLocale}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition"
          title={locale === 'ar' ? 'English' : 'العربية'}
        >
          <Globe size={16} />
          <span>{locale === 'ar' ? 'EN' : 'عربي'}</span>
        </button>

        <button className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition">
          <Bell size={18} />
        </button>

        <div className="flex items-center gap-2 text-sm text-gray-700">
          <div className="w-8 h-8 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center">
            <User size={16} />
          </div>
          <span className="font-medium">{user?.name || ''}</span>
        </div>

        <button
          onClick={handleLogout}
          className="p-2 text-gray-500 hover:bg-red-50 hover:text-red-600 rounded-lg transition"
          title={t('logout')}
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}
