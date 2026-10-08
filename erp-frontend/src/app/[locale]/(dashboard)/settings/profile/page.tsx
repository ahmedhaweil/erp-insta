'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Btn, Card, Field, KeyValue, Spinner, fmtDateTime, inputCls } from '@/components/finance/ui';
import { useFinAction } from '@/hooks/use-finance';
import { adminService } from '@/services/finance-admin.service';

export default function ProfilePage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const { data: me, isLoading } = useQuery({ queryKey: ['me'], queryFn: adminService.getMe });

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');

  const changePassword = useFinAction(() => adminService.changePassword(pw.current, pw.next), {
    invalidate: ['me'],
    success: t('passwordChanged'),
    onSuccess: () => setPw({ current: '', next: '', confirm: '' }),
  });
  const startSetup = useFinAction(adminService.setupTwoFa, {
    invalidate: [],
    success: t('twoFaSetupStarted'),
    onSuccess: (r) => setSetup(r),
  });
  const enable = useFinAction(adminService.enableTwoFa, {
    invalidate: ['me', 'users'],
    success: t('twoFaEnabled'),
    onSuccess: () => {
      setSetup(null);
      setCode('');
    },
  });
  const disable = useFinAction(adminService.disableTwoFa, {
    invalidate: ['me', 'users'],
    success: t('twoFaDisabled'),
    onSuccess: () => setCode(''),
  });

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => toast.success(t('copied')));
  };

  if (isLoading || !me) return <Spinner />;

  const pwMismatch = pw.confirm !== '' && pw.next !== pw.confirm;

  return (
    <div className="space-y-6">
      <PageHeader title={t('profileTitle')} />

      <Card title={t('accountInfo')}>
        <KeyValue
          items={[
            { label: tc('name'), value: me.name },
            { label: tc('email'), value: <span dir="ltr">{me.email}</span> },
            { label: t('roles'), value: me.roles.map((r) => r.name).join('، ') },
            { label: t('lastLogin'), value: <span dir="ltr">{fmtDateTime(me.lastLogin)}</span> },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title={t('changePassword')}>
          <div className="space-y-4">
            <Field label={t('currentPassword')}>
              <input type="password" dir="ltr" className={inputCls} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </Field>
            <Field label={t('newPassword')} hint={t('passwordHint')}>
              <input type="password" dir="ltr" className={inputCls} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </Field>
            <Field label={t('confirmPassword')} error={pwMismatch ? t('passwordMismatch') : undefined}>
              <input type="password" dir="ltr" className={inputCls} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Btn
                disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.confirm || changePassword.isPending}
                onClick={() => changePassword.mutate(undefined)}
              >
                {t('changePassword')}
              </Btn>
            </div>
          </div>
        </Card>

        <Card title={t('twoFaTitle')}>
          <div className="space-y-4">
            <div className={`flex items-center gap-2 text-sm ${me.twoFaEnabled ? 'text-green-700' : 'text-gray-600'}`}>
              {me.twoFaEnabled ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
              {me.twoFaEnabled ? t('twoFaOn') : t('twoFaOff')}
            </div>

            {!me.twoFaEnabled && !setup && (
              <>
                <p className="text-sm text-gray-600">{t('twoFaIntro')}</p>
                <Btn onClick={() => startSetup.mutate(undefined)} disabled={startSetup.isPending}>
                  {t('twoFaStart')}
                </Btn>
              </>
            )}

            {!me.twoFaEnabled && setup && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">{t('twoFaScan')}</p>
                <Field label={t('twoFaSecret')}>
                  <div className="flex gap-2">
                    <input readOnly dir="ltr" className={`${inputCls} font-mono`} value={setup.secret} />
                    <Btn variant="secondary" onClick={() => copy(setup.secret)} aria-label={t('copy')}>
                      <Copy size={14} />
                    </Btn>
                  </div>
                </Field>
                <Field label={t('twoFaUrl')}>
                  <div className="flex gap-2">
                    <input readOnly dir="ltr" className={`${inputCls} font-mono text-xs`} value={setup.otpauthUrl} />
                    <Btn variant="secondary" onClick={() => copy(setup.otpauthUrl)} aria-label={t('copy')}>
                      <Copy size={14} />
                    </Btn>
                  </div>
                </Field>
                <a href={setup.otpauthUrl} className="text-sm text-primary-600 hover:underline">
                  {t('twoFaOpenApp')}
                </a>
                <Field label={t('twoFaCode')}>
                  <input dir="ltr" inputMode="numeric" maxLength={6} className={inputCls} value={code} onChange={(e) => setCode(e.target.value.trim())} />
                </Field>
                <Btn onClick={() => enable.mutate(code)} disabled={code.length < 6 || enable.isPending}>
                  {t('twoFaEnable')}
                </Btn>
              </div>
            )}

            {me.twoFaEnabled && (
              <div className="space-y-3">
                <Field label={t('twoFaCode')} hint={t('twoFaDisableHint')}>
                  <input dir="ltr" inputMode="numeric" maxLength={6} className={inputCls} value={code} onChange={(e) => setCode(e.target.value.trim())} />
                </Field>
                <Btn variant="danger" onClick={() => disable.mutate(code)} disabled={code.length < 6 || disable.isPending}>
                  {t('twoFaDisable')}
                </Btn>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
