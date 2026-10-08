import {
  ColumnSpec,
  buildWorkbook,
  coerceCell,
  matchHeader,
  parseCsv,
  parseMatrices,
  parseSpreadsheet,
  templateSheets,
  toIsoDate,
} from './spreadsheet.util';

const columns: ColumnSpec[] = [
  { key: 'code', label: { en: 'Code', ar: 'الكود' }, required: true },
  { key: 'qty', label: { en: 'Quantity', ar: 'الكمية' }, type: 'number', min: 0 },
  { key: 'active', label: { en: 'Active', ar: 'نشط' }, type: 'boolean' },
  { key: 'date', label: { en: 'Date', ar: 'التاريخ' }, type: 'date' },
  {
    key: 'type',
    label: { en: 'Type', ar: 'النوع' },
    type: 'enum',
    values: [{ value: 'goods', aliases: ['مخزني'] }, { value: 'service', aliases: ['خدمة'] }],
  },
];

describe('spreadsheet util', () => {
  describe('parseCsv', () => {
    it('detects semicolons, handles quotes, escaped quotes, newlines in quotes and a BOM', () => {
      const rows = parseCsv('﻿a;b;c\r\n1;"x;y";"say ""hi"""\n2;"multi\nline";\n');
      expect(rows).toEqual([
        ['a', 'b', 'c'],
        ['1', 'x;y', 'say "hi"'],
        ['2', 'multi\nline', ''],
      ]);
    });

    it('defaults to commas and detects tabs', () => {
      expect(parseCsv('a,b\n1,2')).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ]);
      expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
    });
  });

  describe('coerceCell', () => {
    it('parses numbers with Arabic digits, thousands separators and accounting negatives', () => {
      expect(coerceCell('١٬٢٣٤٫٥', columns[1]).value).toBe(1234.5);
      expect(coerceCell('1,500.25', columns[1]).value).toBe(1500.25);
      expect(coerceCell('(100)', { ...columns[1], min: undefined }).value).toBe(-100);
      expect(coerceCell('abc', columns[1]).error?.code).toBe('invalid_number');
      expect(coerceCell(-1, columns[1]).error?.code).toBe('below_min');
    });

    it('parses Arabic and English booleans', () => {
      expect(coerceCell('نعم', columns[2]).value).toBe(true);
      expect(coerceCell('No', columns[2]).value).toBe(false);
      expect(coerceCell('maybe', columns[2]).error?.code).toBe('invalid_boolean');
    });

    it('matches enum aliases and rejects unknown values', () => {
      expect(coerceCell('خدمة', columns[4]).value).toBe('service');
      expect(coerceCell('GOODS', columns[4]).value).toBe('goods');
      expect(coerceCell('other', columns[4]).error?.code).toBe('invalid_value');
    });

    it('keeps whole numbers as plain strings for text columns (codes, barcodes)', () => {
      expect(coerceCell(6221000000011, columns[0]).value).toBe('6221000000011');
      expect(coerceCell('  P-1 ', columns[0]).value).toBe('P-1');
      expect(coerceCell('', columns[0])).toEqual({});
    });
  });

  describe('toIsoDate', () => {
    it('accepts ISO, day-first and Excel serial dates and rejects impossible ones', () => {
      expect(toIsoDate('2026-01-31')).toBe('2026-01-31');
      expect(toIsoDate('31/12/2026')).toBe('2026-12-31');
      expect(toIsoDate(45658)).toBe('2025-01-01');
      expect(toIsoDate(new Date(Date.UTC(2026, 1, 3)))).toBe('2026-02-03');
      expect(toIsoDate('2026-02-30')).toBeNull();
      expect(toIsoDate('tomorrow')).toBeNull();
    });
  });

  describe('headers', () => {
    it('matches template, English, Arabic and key headers', () => {
      expect(matchHeader('Code / الكود *', columns)?.key).toBe('code');
      expect(matchHeader('الكمية', columns)?.key).toBe('qty');
      expect(matchHeader('active', columns)?.key).toBe('active');
      expect(matchHeader('Something else', columns)).toBeNull();
    });
  });

  describe('parseMatrices', () => {
    it('finds the header row, skips empty rows and reports row-level issues', () => {
      const result = parseMatrices(
        [
          [
            ['My title'],
            ['Code / الكود *', 'الكمية', 'Extra', 'النوع'],
            ['A1', '5', 'x', 'مخزني'],
            [null, null, null, null],
            ['', 'abc', '', ''],
          ],
        ],
        columns,
      );
      expect(result.headerRow).toBe(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({ rowNumber: 3, values: { code: 'A1', qty: 5, type: 'goods' } });
      const codes = result.issues.map((i) => `${i.row}:${i.code}`);
      expect(codes).toEqual(expect.arrayContaining(['2:unknown_column', '5:invalid_number', '5:required']));
    });

    it('reports a missing required column and a file without header', () => {
      expect(parseMatrices([[['Quantity'], ['1']]], columns).issues[0].code).toBe('missing_column');
      expect(parseMatrices([[['foo'], ['1']]], columns).issues[0].code).toBe('header_not_found');
    });
  });

  it('round-trips a generated template through the xlsx parser', async () => {
    const sheets = templateSheets({ en: 'Test', ar: 'اختبار' }, columns);
    sheets[0].rows = [['P-1', 3, 'yes', '2026-05-01', 'service']];
    const buffer = await buildWorkbook(sheets);
    const parsed = await parseSpreadsheet(buffer, 'file.xlsx', columns);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0].values).toEqual({ code: 'P-1', qty: 3, active: true, date: '2026-05-01', type: 'service' });
  });
});
