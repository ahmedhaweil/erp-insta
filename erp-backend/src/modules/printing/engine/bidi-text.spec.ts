import { fontkitReverses, hasArabic, ltr, visualChunks, visualString } from './bidi-text';

/**
 * visualString() returns the characters in the order a reader sees them from
 * left to right (Arabic letters unshaped), i.e. what reaches the page once
 * fontkit has shaped and flipped each Arabic word.
 */
const rev = (s: string) => Array.from(s).reverse().join('');

describe('bidi text helper', () => {
  it('detects Arabic and the words fontkit flips itself', () => {
    expect(hasArabic('فاتورة')).toBe(true);
    expect(hasArabic('Invoice 15')).toBe(false);
    expect(fontkitReverses('(مدين)')).toBe(true);
    expect(fontkitReverses('2026-10-08')).toBe(false);
    expect(fontkitReverses('INV-1')).toBe(false);
  });

  it('orders an Arabic sentence right to left, word by word', () => {
    expect(visualString('فاتورة ضريبية', 'rtl')).toBe('ةيبيرض ةروتاف');
    // Each Arabic word is handed to PDFKit in logical order (for shaping),
    // and the words themselves come in visual order.
    expect(visualChunks('فاتورة ضريبية', 'rtl').map((c) => c.text)).toEqual(['ضريبية', ' ', 'فاتورة']);
  });

  it('keeps numbers and Latin runs left to right inside Arabic text', () => {
    expect(visualString('الإجمالي 1,234.50 جنيه', 'rtl')).toBe(`${rev('جنيه')} 1,234.50 ${rev('الإجمالي')}`);
    expect(visualString('رقم INV-2026-00015', 'rtl')).toBe('INV-2026-00015 مقر');
  });

  it('mirrors brackets in right-to-left runs', () => {
    const chunks = visualChunks('شركة النور (ش.م.م)', 'rtl');
    // fontkit reverses "(ش.م.م)" itself, so the brackets are pre-mirrored.
    expect(chunks[0].text).toBe(')ش.م.م(');
    expect(visualString('شركة (أ)', 'rtl')).toBe('(أ) ةكرش');
  });

  it('isolates values so dates keep their natural order after Arabic words', () => {
    // Plain bidi turns the date into Arabic-number runs (08-10-2026)...
    expect(visualString('بتاريخ 2026-10-08', 'rtl')).toBe('08-10-2026 خيراتب');
    // ...an LTR isolate keeps it as written, and the controls are not drawn.
    expect(visualString(`بتاريخ ${ltr('2026-10-08')}`, 'rtl')).toBe('2026-10-08 خيراتب');
    expect(visualChunks(`بتاريخ ${ltr('2026-10-08')}`, 'rtl').some((c) => /[⁦-⁩]/.test(c.text))).toBe(false);
  });

  it('leaves English text untouched and gives Arabic values their own direction in English documents', () => {
    expect(visualString('Total (incl. VAT)', 'ltr')).toBe('Total (incl. VAT)');
    expect(visualString('مؤسسة الأمل', 'ltr')).toBe(`${rev('الأمل')} ${rev('مؤسسة')}`);
  });

  it('returns no chunks for empty text', () => {
    expect(visualChunks('', 'rtl')).toEqual([]);
  });
});
