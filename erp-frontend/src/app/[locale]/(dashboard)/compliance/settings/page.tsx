'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Btn, Field, inputCls, SelectBox } from '@/components/operations/form';
import { Card, Status, useNamer } from '@/components/operations/common';
import { useOpsMutation, useOpsQuery, useOpsTerminals, useOpsUnits } from '@/hooks/use-operations';
import { opsCompliance } from '@/services/operations-compliance.service';

const TEXT_FIELDS = [
  'taxpayerId', 'taxpayerName', 'commercialRegistration', 'branchCode', 'activityCode', 'governate', 'regionCity', 'street',
  'buildingNumber', 'postalCode', 'district', 'floor', 'room', 'landmark', 'additionalInformation', 'etaClientId', 'etaSignerUrl',
  'defaultUnitType',
] as const;
/** Validated / enum fields: never sent empty. */
const STRICT_FIELDS = ['country', 'addressCountry', 'etaEnvironment', 'etaDocumentVersion', 'defaultTaxSubtype', 'zatcaEnvironment'] as const;
const SECRET_FIELDS = ['etaClientSecret', 'zatcaCsidSecret', 'zatcaPrivateKey'] as const;
type Secret = (typeof SECRET_FIELDS)[number];

interface DeviceDraft {
  serial: string;
  terminalId: string;
  osVersion: string;
  modelFramework: string;
  clientId: string;
  presharedKey: string;
  clientSecret: string;
  hasPresharedKey: boolean;
  hasClientSecret: boolean;
}

/** ETA (Egypt) / ZATCA (Saudi Arabia) e-invoicing settings. Stored secrets are never shown, only "set / not set". */
export default function ComplianceSettingsPage() {
  const t = useTranslations('ops');
  const { data, isLoading } = useOpsQuery(['compliance-settings'], opsCompliance.settings);
  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title={t('comp.settings')} />
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </div>
    );
  }
  return <SettingsForm key={data.updatedAt ?? 'x'} data={data} />;
}

function SettingsForm({ data }: { data: any }) {
  const t = useTranslations('ops');
  const name = useNamer();
  const { data: units = [] } = useOpsUnits();
  const { data: terminals = [] } = useOpsTerminals();
  const [v, setV] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {
      isEnabled: !!data.isEnabled,
      autoSubmit: !!data.autoSubmit,
      zatcaSimplifiedDefault: !!data.zatcaSimplifiedDefault,
      zatcaCertificate: data.zatcaCertificate ?? '',
    };
    [...TEXT_FIELDS, ...STRICT_FIELDS].forEach((f) => (init[f] = data[f] ?? ''));
    return init;
  });
  // Secrets are write-only: empty input keeps the stored value.
  const [secrets, setSecrets] = useState<Record<Secret, string>>({ etaClientSecret: '', zatcaCsidSecret: '', zatcaPrivateKey: '' });
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [unitMap, setUnitMap] = useState<Record<string, string>>(data.unitTypeMap ?? {});
  const [devices, setDevices] = useState<DeviceDraft[]>(
    (data.posDevices ?? []).map((d: any) => ({
      serial: d.serial ?? '',
      terminalId: d.terminalId ?? '',
      osVersion: d.osVersion ?? '',
      modelFramework: d.modelFramework ?? '',
      clientId: d.clientId ?? '',
      presharedKey: '',
      clientSecret: '',
      hasPresharedKey: !!d.presharedKey,
      hasClientSecret: !!d.clientSecret,
    })),
  );
  const set = (k: string, val: any) => setV((p) => ({ ...p, [k]: val }));
  const isEg = v.country !== 'SA';

  const save = useOpsMutation(
    () => {
      const body: Record<string, any> = {
        isEnabled: v.isEnabled,
        autoSubmit: v.autoSubmit,
        zatcaSimplifiedDefault: v.zatcaSimplifiedDefault,
      };
      TEXT_FIELDS.forEach((f) => (body[f] = v[f] ?? ''));
      STRICT_FIELDS.forEach((f) => {
        if (v[f]) body[f] = v[f];
      });
      if (v.zatcaCertificate && v.zatcaCertificate !== data.zatcaCertificate) body.zatcaCertificate = v.zatcaCertificate;
      SECRET_FIELDS.forEach((f) => {
        if (clear[f]) body[f] = '';
        else if (secrets[f]) body[f] = secrets[f];
      });
      body.unitTypeMap = Object.fromEntries(Object.entries(unitMap).filter(([, code]) => code));
      body.posDevices = devices
        .filter((d) => d.serial.trim())
        .map((d) => ({
          serial: d.serial.trim(),
          terminalId: d.terminalId || undefined,
          osVersion: d.osVersion || undefined,
          modelFramework: d.modelFramework || undefined,
          clientId: d.clientId || undefined,
          presharedKey: d.presharedKey || undefined,
          clientSecret: d.clientSecret || undefined,
        }));
      return opsCompliance.updateSettings(body);
    },
    { invalidate: ['compliance-settings'] },
  );

  const text = (k: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} className={inputCls} />
    </Field>
  );
  const secret = (k: Secret, label: string) => (
    <Field label={label} hint={data[k] ? t('comp.secretSetHint') : t('comp.secretNotSet')}>
      <input
        type="password"
        autoComplete="new-password"
        value={secrets[k]}
        disabled={clear[k]}
        placeholder={data[k] ? t('comp.secretKeep') : ''}
        onChange={(e) => setSecrets({ ...secrets, [k]: e.target.value })}
        className={inputCls}
      />
      {data[k] && (
        <label className="flex items-center gap-2 text-xs text-red-600 mt-1">
          <input type="checkbox" checked={!!clear[k]} onChange={(e) => setClear({ ...clear, [k]: e.target.checked })} />
          {t('comp.clearSecret')}
        </label>
      )}
    </Field>
  );
  const setDevice = (i: number, patch: Partial<DeviceDraft>) => setDevices(devices.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  return (
    <form
      className="space-y-4 max-w-5xl"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      <PageHeader title={t('comp.settings')} />
      <div className="flex flex-wrap gap-2 text-sm">
        <span>{t('comp.etaConfigured')}:</span> <Status status={data.configured?.eta ? 'active' : 'inactive'} />
        <span className="ms-4">{t('comp.zatcaConfigured')}:</span> <Status status={data.configured?.zatca ? 'active' : 'inactive'} />
      </div>

      <Card title={t('comp.general')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t('comp.country')}>
            <SelectBox value={v.country} onChange={(x) => set('country', x)} emptyLabel={false} options={[{ value: 'EG', label: t('comp.countries.EG') }, { value: 'SA', label: t('comp.countries.SA') }]} />
          </Field>
          <label className="flex items-center gap-2 text-sm pt-6">
            <input type="checkbox" checked={v.isEnabled} onChange={(e) => set('isEnabled', e.target.checked)} />
            {t('comp.enabled')}
          </label>
          <label className="flex items-center gap-2 text-sm pt-6">
            <input type="checkbox" checked={v.autoSubmit} onChange={(e) => set('autoSubmit', e.target.checked)} />
            {t('comp.autoSubmit')}
          </label>
          {text('taxpayerId', isEg ? t('comp.rin') : t('comp.vatNumber'), isEg ? t('comp.rinHint') : t('comp.vatHint'))}
          {text('taxpayerName', t('comp.taxpayerName'))}
          {text('commercialRegistration', t('comp.commercialRegistration'))}
          {text('branchCode', t('comp.branchCode'))}
          {isEg && text('activityCode', t('comp.activityCode'))}
        </div>
      </Card>

      <Card title={t('comp.address')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {text('addressCountry', t('comp.addressCountry'), 'EG / SA')}
          {text('governate', t('comp.governate'))}
          {text('regionCity', t('comp.regionCity'))}
          {text('district', t('comp.district'))}
          {text('street', t('comp.street'))}
          {text('buildingNumber', t('comp.buildingNumber'))}
          {text('postalCode', t('comp.postalCode'))}
          {text('floor', t('comp.floor'))}
          {text('room', t('comp.room'))}
          {text('landmark', t('comp.landmark'))}
          {text('additionalInformation', t('comp.additionalInformation'))}
        </div>
      </Card>

      {isEg ? (
        <>
          <Card title={t('comp.eta')}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label={t('comp.environment')}>
                <SelectBox value={v.etaEnvironment} onChange={(x) => set('etaEnvironment', x)} emptyLabel={false} options={[{ value: 'preprod', label: t('comp.envs.preprod') }, { value: 'prod', label: t('comp.envs.prod') }]} />
              </Field>
              {text('etaClientId', t('comp.clientId'))}
              {secret('etaClientSecret', t('comp.clientSecret'))}
              {text('etaSignerUrl', t('comp.signerUrl'), t('comp.signerUrlHint'))}
              <Field label={t('comp.documentVersion')}>
                <SelectBox value={v.etaDocumentVersion} onChange={(x) => set('etaDocumentVersion', x)} emptyLabel={false} options={[{ value: '1.0', label: '1.0' }, { value: '0.9', label: '0.9' }]} />
              </Field>
              {text('defaultUnitType', t('comp.defaultUnitType'), 'EA, KGM, LTR...')}
              <Field label={t('comp.defaultTaxSubtype')}>
                <SelectBox
                  value={v.defaultTaxSubtype}
                  onChange={(x) => set('defaultTaxSubtype', x)}
                  emptyLabel="-"
                  options={Array.from({ length: 10 }, (_, i) => `V0${String(i + 1).padStart(2, '0')}`).map((c) => ({ value: c, label: c }))}
                />
              </Field>
            </div>
          </Card>
          <Card title={t('comp.unitTypeMap')}>
            <p className="text-sm text-gray-600 mb-3">{t('comp.unitTypeMapHint')}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {units.map((u) => (
                <Field key={u.id} label={`${name(u)} (${u.symbol})`}>
                  <input value={unitMap[u.id] ?? ''} onChange={(e) => setUnitMap({ ...unitMap, [u.id]: e.target.value.toUpperCase() })} className={inputCls} placeholder={v.defaultUnitType || 'EA'} />
                </Field>
              ))}
            </div>
          </Card>
          <Card
            title={t('comp.posDevices')}
            actions={
              <Btn size="sm" variant="secondary" onClick={() => setDevices([...devices, { serial: '', terminalId: '', osVersion: '', modelFramework: '', clientId: '', presharedKey: '', clientSecret: '', hasPresharedKey: false, hasClientSecret: false }])}>
                <span className="inline-flex items-center gap-1"><Plus size={14} /> {t('comp.addDevice')}</span>
              </Btn>
            }
          >
            <p className="text-sm text-gray-600 mb-3">{t('comp.posDevicesHint')}</p>
            <div className="space-y-3">
              {devices.map((d, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-3 border border-gray-200 rounded-lg p-3">
                  <Field label={t('comp.deviceSerial')} required>
                    <input value={d.serial} onChange={(e) => setDevice(i, { serial: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label={t('comp.terminal')}>
                    <SelectBox value={d.terminalId} onChange={(x) => setDevice(i, { terminalId: x })} options={terminals.map((x) => ({ value: x.id, label: x.name }))} />
                  </Field>
                  <Field label={t('comp.osVersion')}>
                    <input value={d.osVersion} onChange={(e) => setDevice(i, { osVersion: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label={t('comp.modelFramework')}>
                    <input value={d.modelFramework} onChange={(e) => setDevice(i, { modelFramework: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label={t('comp.clientId')}>
                    <input value={d.clientId} onChange={(e) => setDevice(i, { clientId: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label={t('comp.clientSecret')} hint={d.hasClientSecret ? t('comp.secretSetHint') : t('comp.secretNotSet')}>
                    <input type="password" autoComplete="new-password" value={d.clientSecret} placeholder={d.hasClientSecret ? t('comp.secretKeep') : ''} onChange={(e) => setDevice(i, { clientSecret: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label={t('comp.presharedKey')} hint={d.hasPresharedKey ? t('comp.secretSetHint') : t('comp.secretNotSet')}>
                    <input type="password" autoComplete="new-password" value={d.presharedKey} placeholder={d.hasPresharedKey ? t('comp.secretKeep') : ''} onChange={(e) => setDevice(i, { presharedKey: e.target.value })} className={inputCls} />
                  </Field>
                  <div className="flex items-end">
                    <Btn size="sm" variant="danger" onClick={() => setDevices(devices.filter((_, idx) => idx !== i))}>
                      <span className="inline-flex items-center gap-1"><Trash2 size={14} /> {t('common.remove')}</span>
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card title={t('comp.zatca')}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={t('comp.environment')}>
              <SelectBox
                value={v.zatcaEnvironment}
                onChange={(x) => set('zatcaEnvironment', x)}
                emptyLabel={false}
                options={['sandbox', 'simulation', 'production'].map((e) => ({ value: e, label: t(`comp.envs.${e}`) }))}
              />
            </Field>
            {secret('zatcaCsidSecret', t('comp.csidSecret'))}
            {secret('zatcaPrivateKey', t('comp.privateKey'))}
            <label className="flex items-center gap-2 text-sm pt-6">
              <input type="checkbox" checked={v.zatcaSimplifiedDefault} onChange={(e) => set('zatcaSimplifiedDefault', e.target.checked)} />
              {t('comp.simplifiedDefault')}
            </label>
            <Field label={t('comp.certificate')} hint={t('comp.certificateHint')} className="md:col-span-3">
              <textarea rows={4} value={v.zatcaCertificate} onChange={(e) => set('zatcaCertificate', e.target.value)} className={`${inputCls} font-mono text-xs`} />
            </Field>
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <Btn type="submit" size="lg" loading={save.isPending}>{t('common.save')}</Btn>
      </div>
    </form>
  );
}
