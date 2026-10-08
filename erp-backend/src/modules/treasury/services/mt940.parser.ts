/**
 * SWIFT MT940 customer statement parser (pure). Supports the common subset
 * banks export: :20: reference, :25: account, :28C: statement number,
 * :60F:/:60M: opening balance, :61: statement lines (with an optional
 * supplementary line), :86: information to the account owner, :62F:/:62M:
 * closing balance. Several statements in one file are concatenated; block
 * wrappers ({1:...}{4: ... -}) are ignored.
 */

export interface Mt940Line {
  date: string;
  entryDate: string | null;
  /** Signed: positive = credit (deposit), negative = debit (withdrawal). */
  amount: number;
  /** Transaction type code (e.g. NTRF, NCHK, NMSC). */
  transactionType: string;
  /** Customer reference (before //). */
  reference: string | undefined;
  bankReference: string | undefined;
  description: string | undefined;
}

export interface Mt940Balance {
  date: string;
  currency: string;
  amount: number;
}

export interface Mt940Statement {
  transactionReference: string | null;
  accountId: string | null;
  statementNumber: string | null;
  currency: string | null;
  opening: Mt940Balance | null;
  closing: Mt940Balance | null;
  lines: Mt940Line[];
}

export class Mt940Error extends Error {}

function toIsoDate(yymmdd: string): string {
  const yy = Number(yymmdd.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${year}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function parseAmount(text: string): number {
  const value = Number(text.replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(value)) throw new Mt940Error(`Invalid amount "${text}"`);
  return value;
}

/** :60F: / :62F: value, e.g. C261001EGP1000,00 */
export function parseBalance(value: string): Mt940Balance {
  const m = /^([CD])(\d{6})([A-Z]{3})([\d.,]+)/.exec(value.trim());
  if (!m) throw new Mt940Error(`Invalid balance "${value}"`);
  const amount = parseAmount(m[4]);
  return { date: toIsoDate(m[2]), currency: m[3], amount: m[1] === 'D' ? -amount : amount };
}

const LINE_61 = /^(\d{6})(\d{4})?(RC|RD|C|D)([A-Z])?([\d,]+)([NFS][A-Z0-9]{3})([^\n]*)(?:\n([\s\S]*))?$/;

/** :61: value, e.g. 2610021002D150,50NTRFINV-77//B123 + optional supplementary line. */
export function parseStatementLine(value: string): Omit<Mt940Line, 'description'> & { supplementary?: string } {
  const m = LINE_61.exec(value.trim());
  if (!m) throw new Mt940Error(`Invalid :61: line "${value}"`);
  const [, valueDate, entry, mark, , amountText, type, refs, supplementary] = m;
  const amount = parseAmount(amountText);
  const debit = mark === 'D' || mark === 'RC';
  let entryDate: string | null = null;
  if (entry) {
    const year = Number(toIsoDate(valueDate).slice(0, 4));
    entryDate = `${year}-${entry.slice(0, 2)}-${entry.slice(2, 4)}`;
  }
  const [reference, bankReference] = refs.split('//');
  const clean = (s?: string) => (s && s.trim() && s.trim() !== 'NONREF' ? s.trim() : undefined);
  return {
    date: toIsoDate(valueDate),
    entryDate,
    amount: debit ? -amount : amount,
    transactionType: type,
    reference: clean(reference),
    bankReference: clean(bankReference),
    supplementary: clean(supplementary?.replace(/\s*\n\s*/g, ' ')),
  };
}

/** Splits the text into [tag, value] pairs; continuation lines belong to the previous tag. */
function tokenize(text: string): [string, string][] {
  const out: [string, string][] = [];
  const body = text
    .replace(/\r\n?/g, '\n')
    .replace(/\{[1-3]:[^}]*\}/g, '')
    .replace(/\{4:/g, '')
    .replace(/^-\}?\s*$/gm, '')
    .replace(/\}/g, '');
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const tag = /^:(\d{2}[A-Z]?):(.*)$/.exec(line);
    if (tag) out.push([tag[1], tag[2]]);
    else if (out.length && line.trim()) out[out.length - 1][1] += `\n${line}`;
  }
  return out;
}

export function parseMt940(text: string): Mt940Statement {
  const tokens = tokenize(text ?? '');
  if (!tokens.length) throw new Mt940Error('No MT940 fields found');
  const statement: Mt940Statement = {
    transactionReference: null,
    accountId: null,
    statementNumber: null,
    currency: null,
    opening: null,
    closing: null,
    lines: [],
  };
  let current: Mt940Line | null = null;
  for (const [tag, value] of tokens) {
    switch (tag) {
      case '20':
        statement.transactionReference ??= value.trim();
        break;
      case '25':
        statement.accountId ??= value.trim();
        break;
      case '28C':
      case '28':
        statement.statementNumber ??= value.trim();
        break;
      case '60F':
      case '60M':
        if (!statement.opening) {
          statement.opening = parseBalance(value);
          statement.currency = statement.opening.currency;
        }
        break;
      case '61': {
        const { supplementary, ...line } = parseStatementLine(value);
        current = { ...line, description: supplementary };
        statement.lines.push(current);
        break;
      }
      case '86':
        if (current) {
          const info = value.replace(/\s*\n\s*/g, ' ').trim();
          current.description = [current.description, info].filter(Boolean).join(' - ') || undefined;
        }
        break;
      case '62F':
      case '62M':
        statement.closing = parseBalance(value);
        statement.currency ??= statement.closing.currency;
        current = null;
        break;
      default:
        break;
    }
  }
  if (!statement.lines.length && !statement.opening) throw new Mt940Error('No MT940 statement found');
  return statement;
}
