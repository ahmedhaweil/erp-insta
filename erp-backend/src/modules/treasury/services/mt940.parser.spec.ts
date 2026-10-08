import { parseBalance, parseMt940, parseStatementLine } from './mt940.parser';
import { BankReconciliationService } from './bank-reconciliation.service';
import { BadRequestException } from '@nestjs/common';

const SAMPLE = [
  '{1:F01NBEGEGCXAXXX0000000000}{2:I940NBEGEGCXXXXXN}{4:',
  ':20:STMT-2610',
  ':25:EG380019000500000000263180002',
  ':28C:00045/001',
  ':60F:C260930EGP10000,00',
  ':61:2610011001D1500,50NTRFINV-77//B261001-1',
  'Supplier transfer',
  ':86:Payment to Delta Supplies',
  ':61:261002C2500,NCHKCHQ-456//B261002-9',
  ':86:Cheque deposit',
  '  customer Nile Trading',
  ':61:261003D25,NCHGNONREF',
  ':86:Bank charges',
  ':61:2610041004RCD100,NMSCREV-1',
  ':62F:C261004EGP10874,50',
  '-}',
].join('\r\n');

describe('MT940 parser', () => {
  it('parses balances', () => {
    expect(parseBalance('C260930EGP10000,00')).toEqual({ date: '2026-09-30', currency: 'EGP', amount: 10000 });
    expect(parseBalance('D261004SAR12,5')).toEqual({ date: '2026-10-04', currency: 'SAR', amount: -12.5 });
  });

  it('parses a :61: line with entry date, references and supplementary details', () => {
    expect(parseStatementLine('2610011001D1500,50NTRFINV-77//B261001-1\nSupplier transfer')).toEqual({
      date: '2026-10-01',
      entryDate: '2026-10-01',
      amount: -1500.5,
      transactionType: 'NTRF',
      reference: 'INV-77',
      bankReference: 'B261001-1',
      supplementary: 'Supplier transfer',
    });
  });

  it('parses a full statement', () => {
    const statement = parseMt940(SAMPLE);
    expect(statement).toMatchObject({
      transactionReference: 'STMT-2610',
      accountId: 'EG380019000500000000263180002',
      statementNumber: '00045/001',
      currency: 'EGP',
      opening: { date: '2026-09-30', amount: 10000 },
      closing: { date: '2026-10-04', amount: 10874.5 },
    });
    expect(statement.lines.map((l) => l.amount)).toEqual([-1500.5, 2500, -25, -100]);
    expect(statement.lines[0].description).toBe('Supplier transfer - Payment to Delta Supplies');
    expect(statement.lines[1].description).toBe('Cheque deposit customer Nile Trading');
    expect(statement.lines[2].reference).toBeUndefined(); // NONREF
    // RC = reversal of a credit -> debit; funds code letter skipped.
    expect(statement.lines[3]).toMatchObject({ amount: -100, transactionType: 'NMSC', reference: 'REV-1' });
    const movement = statement.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round((statement.opening!.amount + movement) * 100) / 100).toBe(statement.closing!.amount);
  });

  it('maps MT940 lines to statement lines and rejects malformed input', () => {
    const { lines } = BankReconciliationService.parseMt940(SAMPLE);
    expect(lines[1]).toEqual({
      date: '2026-10-02',
      amount: 2500,
      reference: 'CHQ-456',
      description: 'NCHK Cheque deposit customer Nile Trading',
    });
    expect(() => BankReconciliationService.parseMt940('hello')).toThrow(BadRequestException);
    expect(() => BankReconciliationService.parseMt940(':20:X\n:61:garbage')).toThrow(BadRequestException);
  });
});
