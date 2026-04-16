'use client';

import { Toaster as SonnerToaster } from 'sonner';
import { useLocale } from 'next-intl';

export default function Toaster() {
  const locale = useLocale();

  return (
    <SonnerToaster
      position={locale === 'ar' ? 'top-left' : 'top-right'}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      richColors
      closeButton
      duration={4000}
    />
  );
}
