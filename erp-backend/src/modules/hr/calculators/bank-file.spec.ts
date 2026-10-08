import { buildBankFile, csvCell, isValidIban, saudiBankCode } from './bank-file';

describe('salary bank files', () => {
  const rows = [
    {
      employeeCode: 'EMP-1',
      employeeName: 'Ahmed, Ali',
      nationalId: '1010101010',
      bankName: 'Al Rajhi',
      bankAccount: '608010167519',
      iban: 'SA03 8000 0000 6080 1016 7519',
      basic: 8000,
      housing: 2000,
      gross: 11000,
      deductions: 975,
      net: 10025,
    },
    {
      employeeCode: 'EMP-2',
      employeeName: 'No Bank',
      basic: 5000,
      housing: 0,
      gross: 5000,
      deductions: 0,
      net: 5000,
    },
  ];
  const meta = { reference: 'PAY-000001', period: '2026-10', valueDate: '2026-10-31' };

  it('validates IBAN checksums and extracts the Saudi bank code', () => {
    expect(isValidIban('SA0380000000608010167519')).toBe(true);
    expect(isValidIban('SA0380000000608010167518')).toBe(false);
    expect(isValidIban('EG380019000500000000263180002')).toBe(true);
    expect(saudiBankCode('SA0380000000608010167519')).toBe('80');
  });

  it('escapes CSV cells', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
  });

  it('builds a generic bank sheet and skips employees without bank details', () => {
    const file = buildBankFile('generic', rows, meta);
    expect(file.count).toBe(1);
    expect(file.total).toBe(10025);
    expect(file.warnings).toEqual([{ employeeCode: 'EMP-2', message: expect.stringContaining('No IBAN') }]);
    const lines = file.content.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'Employee Code,Employee Name,National ID,Bank Name,Account Number,IBAN,Amount,Reference,Value Date',
    );
    expect(lines[1]).toBe(
      'EMP-1,"Ahmed, Ali",1010101010,Al Rajhi,608010167519,SA0380000000608010167519,10025.00,PAY-000001 2026-10,2026-10-31',
    );
  });

  it('builds a WPS / Mudad-style file whose components add up to the net', () => {
    const file = buildBankFile('wps', rows, meta);
    const [header, line] = file.content.replace('﻿', '').trim().split('\r\n');
    expect(header.split(',')).toEqual([
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
    ]);
    expect(line).toContain(',80,SA0380000000608010167519,8000.00,2000.00,1000.00,975.00,10025.00,2026-10,');
    expect(file.filename).toBe('salaries-2026-10-wps.csv');
  });

  it('warns about an invalid IBAN but keeps the row', () => {
    const file = buildBankFile('generic', [{ ...rows[0], iban: 'SA0380000000608010167518' }], meta);
    expect(file.count).toBe(1);
    expect(file.warnings[0].message).toContain('checksum');
  });
});
