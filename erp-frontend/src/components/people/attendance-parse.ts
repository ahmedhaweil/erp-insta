import type { ImportRow } from '@/services/people-hr.service';

const FIELDS = ['employeeId', 'employeeCode', 'date', 'checkIn', 'checkOut', 'notes'] as const;
const ALIASES: Record<string, (typeof FIELDS)[number]> = {
  employeeid: 'employeeId',
  employee_id: 'employeeId',
  employeecode: 'employeeCode',
  employee_code: 'employeeCode',
  code: 'employeeCode',
  date: 'date',
  checkin: 'checkIn',
  check_in: 'checkIn',
  in: 'checkIn',
  checkout: 'checkOut',
  check_out: 'checkOut',
  out: 'checkOut',
  notes: 'notes',
  note: 'notes',
};

function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function normalise(raw: Record<string, unknown>): ImportRow {
  const row: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = ALIASES[key.trim().toLowerCase()] ?? (FIELDS as readonly string[]).find((f) => f === key);
    if (field && value !== undefined && value !== null && String(value).trim() !== '') row[field] = String(value).trim();
  }
  return row as unknown as ImportRow;
}

/**
 * Parses pasted attendance data: a JSON array of objects, or CSV/TSV with a
 * header row (employeeCode,date,checkIn,checkOut,notes). Without a header the
 * columns are taken in that order.
 */
export function parseAttendance(text: string): ImportRow[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed) ? parsed : parsed.records;
    if (!Array.isArray(list)) throw new Error('JSON must be an array');
    return list.map((r) => normalise(r));
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const first = splitLine(lines[0], sep);
  const hasHeader = first.some((c) => ALIASES[c.toLowerCase()]);
  const headers = hasHeader ? first : ['employeeCode', 'date', 'checkIn', 'checkOut', 'notes'];
  return lines.slice(hasHeader ? 1 : 0).map((line) => {
    const cells = splitLine(line, sep);
    return normalise(Object.fromEntries(headers.map((h, i) => [h, cells[i]])));
  });
}
