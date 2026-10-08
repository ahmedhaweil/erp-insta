'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { dataImportService, type ImportEntity } from '@/services/platform.service';
import { errorMessage } from './ui';

/** "Export / Import" dropdown for master-data lists (Excel in Arabic or English, link to the import wizard). */
export default function ExportMenu({ entity }: { entity: ImportEntity }) {
  const t = useTranslations('imp');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const exportAs = async (lang: 'ar' | 'en') => {
    setOpen(false);
    setBusy(true);
    try {
      await dataImportService.exportData(entity, lang);
    } catch (err) {
      toast.error(errorMessage(err, t('downloadFailed')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 disabled:opacity-50"
      >
        <Download size={15} /> {busy ? t('exporting') : t('exportMenu')} <ChevronDown size={13} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 end-0 min-w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm">
          <button type="button" className="w-full text-start px-3 py-2 hover:bg-gray-50" onClick={() => exportAs('ar')}>
            {t('excel_ar')}
          </button>
          <button type="button" className="w-full text-start px-3 py-2 hover:bg-gray-50" onClick={() => exportAs('en')}>
            {t('excel_en')}
          </button>
          <Link href="/settings/import" className="flex items-center gap-1.5 px-3 py-2 hover:bg-gray-50 border-t border-gray-100 text-primary-600">
            <Upload size={14} /> {t('importFromExcel')}
          </Link>
        </div>
      )}
    </div>
  );
}
