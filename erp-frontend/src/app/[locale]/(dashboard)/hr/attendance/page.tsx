'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/ui/PageHeader';
import { Button, Card, ErrorBox, Field, Input, Select, SimpleTable, Tabs, TextArea, Toolbar, td, todayIso } from '@/components/people/ui';
import { parseAttendance } from '@/components/people/attendance-parse';
import {
  useBranches,
  useDepartments,

  useLabelMap,
  useLocalName,
  usePeopleMutation,
  usePeopleQuery,
} from '@/hooks/use-people';
import { hrService, type ImportResult, type ImportRow } from '@/services/people-hr.service';

type Tab = 'daily' | 'import' | 'summary';
interface RowState {
  checkIn: string;
  checkOut: string;
  notes: string;
  dirty: boolean;
}

function DailyGrid() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const tp = useTranslations('people');
  const name = useLocalName();
  const [date, setDate] = useState(todayIso());
  const [departmentId, setDepartmentId] = useState('');
  const { data: departments } = useDepartments();
  const deptMap = useLabelMap(departments, false);
  const { data: employees = [] } = usePeopleQuery(['hr-employees', 'grid', departmentId], () =>
    hrService.employees({ status: 'active', departmentId }),
  );
  const { data: records = [], isLoading } = usePeopleQuery(['hr-attendance', date], () => hrService.attendance({ from: date, to: date }));
  const [rows, setRows] = useState<Record<string, RowState>>({});

  const byEmployee = useMemo(() => new Map(records.map((r) => [r.employeeId, r])), [records]);
  const visible = employees.filter((e) => String(e.hireDate).slice(0, 10) <= date);

  useEffect(() => {
    const next: Record<string, RowState> = {};
    for (const r of records) next[r.employeeId] = { checkIn: r.checkIn?.slice(0, 5) ?? '', checkOut: r.checkOut?.slice(0, 5) ?? '', notes: r.notes ?? '', dirty: false };
    setRows(next);
  }, [records]);

  const save = usePeopleMutation(
    async (ids: string[]) => {
      for (const employeeId of ids) {
        const r = rows[employeeId];
        await hrService.upsertAttendance({ employeeId, date, checkIn: r.checkIn || undefined, checkOut: r.checkOut || undefined, notes: r.notes || undefined });
      }
    },
    { invalidate: ['hr-attendance'], success: t('attendanceSaved') },
  );
  const remove = usePeopleMutation((id: string) => hrService.deleteAttendance(id), { invalidate: ['hr-attendance'], success: tc('deleteSuccess') });

  const update = (employeeId: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [employeeId]: { ...(prev[employeeId] ?? { checkIn: '', checkOut: '', notes: '' }), ...patch, dirty: true } }));

  const dirtyIds = Object.entries(rows).filter(([, r]) => r.dirty && r.checkIn).map(([id]) => id);

  return (
    <div>
      <Toolbar>
        <Field label={tc('date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('department')}>
          <Select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} placeholder={tc('all')} options={[...deptMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Button onClick={() => save.mutate(dirtyIds)} disabled={!dirtyIds.length || save.isPending}>
          {t('saveChanges')} ({dirtyIds.length})
        </Button>
      </Toolbar>
      {isLoading ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <SimpleTable headers={[tc('code'), tc('name'), t('checkIn'), t('checkOut'), tc('notes'), t('source'), tc('actions')]}>
          {visible.map((e) => {
            const record = byEmployee.get(e.id);
            const r = rows[e.id] ?? { checkIn: '', checkOut: '', notes: '', dirty: false };
            return (
              <tr key={e.id} className={r.dirty ? 'bg-yellow-50' : undefined}>
                <td className={td}>{e.code}</td>
                <td className={td}>
                  {name(e)}
                  {!e.trackAttendance && <span className="ms-2 text-xs text-gray-400">({t('notTracked')})</span>}
                </td>
                <td className={td}>
                  <Input type="time" value={r.checkIn} onChange={(ev) => update(e.id, { checkIn: ev.target.value })} className="w-32" />
                </td>
                <td className={td}>
                  <Input type="time" value={r.checkOut} onChange={(ev) => update(e.id, { checkOut: ev.target.value })} className="w-32" />
                </td>
                <td className={td}>
                  <Input value={r.notes} onChange={(ev) => update(e.id, { notes: ev.target.value })} className="w-48" />
                </td>
                <td className={td}>{record ? t(`source_${record.source}`) : '-'}</td>
                <td className={td}>
                  <div className="flex gap-3">
                    <button type="button" className="text-primary-600 text-sm hover:underline disabled:opacity-50" disabled={!r.checkIn || save.isPending} onClick={() => save.mutate([e.id])}>
                      {tc('save')}
                    </button>
                    {record && (
                      <button type="button" className="text-red-600 text-sm hover:underline" onClick={() => remove.mutate(record.id)}>
                        {tc('delete')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
          {!visible.length && (
            <tr>
              <td colSpan={7} className="p-8 text-center text-gray-500">
                {tp('noEmployees')}
              </td>
            </tr>
          )}
        </SimpleTable>
      )}
    </div>
  );
}

function ImportPanel() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const doImport = usePeopleMutation((records: ImportRow[]) => hrService.importAttendance(records), {
    invalidate: ['hr-attendance'],
    success: t('importDone'),
    onSuccess: (res) => setResult(res),
  });

  const preview = () => {
    setResult(null);
    try {
      const parsed = parseAttendance(text);
      setRows(parsed);
      setParseError(parsed.length ? null : t('importEmpty'));
    } catch (err) {
      setRows([]);
      setParseError(`${t('importParseError')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      <Card title={t('importTitle')}>
        <p className="text-sm text-gray-600 mb-2">{t('importHint')}</p>
        <pre dir="ltr" className="text-xs bg-gray-50 border border-gray-200 rounded p-2 mb-3 overflow-x-auto">
          {'employeeCode,date,checkIn,checkOut,notes\nEMP-000001,2026-10-01,09:02,17:10,\n[{"employeeCode":"EMP-000002","date":"2026-10-01","checkIn":"08:55","checkOut":"17:00"}]'}
        </pre>
        <TextArea dir="ltr" rows={10} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" />
        <div className="flex gap-3 mt-3">
          <Button variant="secondary" onClick={preview} disabled={!text.trim()}>
            {t('preview')}
          </Button>
          <Button onClick={() => doImport.mutate(rows)} disabled={!rows.length || doImport.isPending}>
            {doImport.isPending ? tc('loading') : `${t('importRows')} (${rows.length})`}
          </Button>
        </div>
      </Card>
      <ErrorBox message={parseError} />
      {result && (
        <Card title={t('importResult')}>
          <p className="text-sm mb-3">{t('importSummary', { received: result.received, imported: result.imported, failed: result.failed })}</p>
          {result.errors.length > 0 && (
            <SimpleTable headers={[t('row'), tc('error')]}>
              {result.errors.map((e) => (
                <tr key={e.row}>
                  <td className={td}>{e.row + 1}</td>
                  <td className="px-3 py-2 text-red-700">{e.error}</td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </Card>
      )}
      {rows.length > 0 && !result && (
        <SimpleTable headers={[t('row'), t('employee'), tc('date'), t('checkIn'), t('checkOut'), tc('notes')]}>
          {rows.slice(0, 200).map((r, i) => (
            <tr key={i}>
              <td className={td}>{i + 1}</td>
              <td className={td}>{r.employeeCode ?? r.employeeId}</td>
              <td className={td}>{r.date}</td>
              <td className={td}>{r.checkIn}</td>
              <td className={td}>{r.checkOut}</td>
              <td className={td}>{r.notes}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  );
}

function SummaryPanel() {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from: first, to: last, branchId: '', departmentId: '' });
  const [applied, setApplied] = useState(filters);
  const { data: branches } = useBranches();
  const { data: departments } = useDepartments();
  const branchMap = useLabelMap(branches, false);
  const deptMap = useLabelMap(departments, false);
  const { data = [], isLoading, error } = usePeopleQuery(['hr-attendance', 'summary', applied], () => hrService.attendanceSummary(applied));

  return (
    <div>
      <Toolbar>
        <Field label={t('from')}>
          <Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </Field>
        <Field label={t('to')}>
          <Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </Field>
        <Field label={t('branch')}>
          <Select value={filters.branchId} onChange={(e) => setFilters((f) => ({ ...f, branchId: e.target.value }))} placeholder={tc('all')} options={[...branchMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label={t('department')}>
          <Select value={filters.departmentId} onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value }))} placeholder={tc('all')} options={[...deptMap].map(([value, label]) => ({ value, label }))} />
        </Field>
        <Button onClick={() => setApplied(filters)}>{t('apply')}</Button>
      </Toolbar>
      {error && <ErrorBox message={tc('error')} />}
      {isLoading ? (
        <div className="text-gray-500">{tc('loading')}</div>
      ) : (
        <SimpleTable
          headers={[tc('code'), tc('name'), t('workingDays'), t('presentDays'), t('absenceDays'), t('paidLeaveDays'), t('unpaidLeaveDays'), t('lateMinutes'), t('workedHours'), t('overtimeHours')]}
        >
          {data.map((r) => (
            <tr key={r.employeeId}>
              <td className={td}>{r.employeeCode}</td>
              <td className={td}>
                {r.employeeName}
                {!r.trackAttendance && <span className="ms-2 text-xs text-gray-400">({t('notTracked')})</span>}
              </td>
              <td className={td}>{r.workingDays}</td>
              <td className={td}>{r.presentDays}</td>
              <td className={td}>{r.absenceDays}</td>
              <td className={td}>{r.paidLeaveDays}</td>
              <td className={td}>{r.unpaidLeaveDays}</td>
              <td className={td}>{r.lateMinutes}</td>
              <td className={td}>{r.workedHours}</td>
              <td className={td}>{r.overtimeHours}</td>
            </tr>
          ))}
        </SimpleTable>
      )}
    </div>
  );
}

export default function AttendancePage() {
  const t = useTranslations('hr');
  const [tab, setTab] = useState<Tab>('daily');
  return (
    <div>
      <PageHeader title={t('attendance')} />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'daily', label: t('dailyGrid') },
          { key: 'import', label: t('bulkImport') },
          { key: 'summary', label: t('monthlySummary') },
        ]}
      />
      {tab === 'daily' && <DailyGrid />}
      {tab === 'import' && <ImportPanel />}
      {tab === 'summary' && <SummaryPanel />}
    </div>
  );
}
