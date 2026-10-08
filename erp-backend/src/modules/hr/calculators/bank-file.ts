/**
 * Salary transfer files (pure): a generic bank sheet and a Saudi WPS /
 * Mudad-style payroll file, both CSV.
 */

export type BankFileFormat = 'generic' | 'wps';

export interface BankFileRow {
  employeeCode: string;
  employeeName: string;
  employeeNameAr?: string | null;
  nationalId?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  iban?: string | null;
  basic: number;
  housing: number;
  gross: number;
  deductions: number;
  net: number;
}

export interface BankFileResult {
  format: BankFileFormat;
  filename: string;
  contentType: string;
  count: number;
  total: number;
  /** Employees left out (no IBAN / account) or with an invalid IBAN. */
  warnings: { employeeCode: string; message: string }[];
  content: string;
}

const r2 = (v: number) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const money = (v: number) => r2(v).toFixed(2);

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function normaliseIban(iban?: string | null): string {
  return String(iban ?? '').replace(/\s+/g, '').toUpperCase();
}

/** ISO 13616 mod-97 check of an IBAN. */
export function isValidIban(iban?: string | null): boolean {
  const value = normaliseIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(value)) return false;
  const rearranged = value.slice(4) + value.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/** Saudi IBANs carry the 2-digit bank code after the check digits (SAkk BB...). */
export function saudiBankCode(iban?: string | null): string {
  const value = normaliseIban(iban);
  return value.startsWith('SA') && value.length >= 6 ? value.slice(4, 6) : '';
}

export function buildBankFile(
  format: BankFileFormat,
  rows: BankFileRow[],
  meta: { reference: string; period: string; valueDate: string },
): BankFileResult {
  const warnings: BankFileResult['warnings'] = [];
  const payable = rows.filter((row) => {
    const iban = normaliseIban(row.iban);
    if (!iban && !(format === 'generic' && row.bankAccount)) {
      warnings.push({ employeeCode: row.employeeCode, message: 'No IBAN / bank account: pay separately' });
      return false;
    }
    if (iban && !isValidIban(iban)) {
      warnings.push({ employeeCode: row.employeeCode, message: `IBAN ${iban} fails the checksum` });
    }
    return true;
  });

  let lines: unknown[][];
  if (format === 'wps') {
    lines = [
      [
        'Employee Number',
        'Employee Name',
        'ID Number',
        'Bank Code',
        'IBAN',
        'Basic Salary',
        'Housing Allowance',
        'Other Earnings',
        'Deductions',
        'Net Salary',
        'Payment Period',
        'Value Date',
      ],
      ...payable.map((r) => {
        const other = r2(r.gross - r.basic - r.housing);
        return [
          r.employeeCode,
          r.employeeName,
          r.nationalId ?? '',
          saudiBankCode(r.iban),
          normaliseIban(r.iban),
          money(r.basic),
          money(r.housing),
          money(other),
          money(r.deductions),
          money(r.net),
          meta.period,
          meta.valueDate,
        ];
      }),
    ];
  } else {
    lines = [
      [
        'Employee Code',
        'Employee Name',
        'National ID',
        'Bank Name',
        'Account Number',
        'IBAN',
        'Amount',
        'Reference',
        'Value Date',
      ],
      ...payable.map((r) => [
        r.employeeCode,
        r.employeeName,
        r.nationalId ?? '',
        r.bankName ?? '',
        r.bankAccount ?? '',
        normaliseIban(r.iban),
        money(r.net),
        `${meta.reference} ${meta.period}`,
        meta.valueDate,
      ]),
    ];
  }
  const total = r2(payable.reduce((s, r) => s + Number(r.net), 0));
  return {
    format,
    filename: `salaries-${meta.period}-${format}.csv`,
    contentType: 'text/csv; charset=utf-8',
    count: payable.length,
    total,
    warnings,
    content: '﻿' + toCsv(lines),
  };
}
