/**
 * Amounts in words (التفقيط) for printed documents, in Arabic and English.
 *
 * Arabic follows the usual commercial form:
 *   "فقط ألف ومائتان وخمسة وثلاثون جنيهاً مصرياً وخمسون قرشاً لا غير"
 * with the counted-noun rules (1 / 2 / 3-10 plural / 11-99 accusative
 * singular / otherwise genitive singular) and feminine numerals for feminine
 * units (هللة).
 */

export type WordsLang = 'ar' | 'en';

interface ArNoun {
  /** 1: the noun with its adjective (followed by "واحد"/"واحدة"). */
  one: string;
  /** 2: dual form. */
  two: string;
  /** 3-10: plural. */
  few: string;
  /** 11-99: accusative singular (tamyeez). */
  many: string;
  /** 0, 100, 1000... and 101/102...: genitive singular. */
  other: string;
  feminine?: boolean;
}

interface CurrencyWords {
  ar: { major: ArNoun; minor: ArNoun };
  en: { major: [string, string]; minor: [string, string] };
  /** Minor units per major unit (only 100 supported for now; 1000 for 3-decimal currencies). */
  minorUnits: number;
}

const CURRENCIES: Record<string, CurrencyWords> = {
  EGP: {
    ar: {
      major: {
        one: 'جنيه مصري',
        two: 'جنيهان مصريان',
        few: 'جنيهات مصرية',
        many: 'جنيهاً مصرياً',
        other: 'جنيه مصري',
      },
      minor: { one: 'قرش', two: 'قرشان', few: 'قروش', many: 'قرشاً', other: 'قرش' },
    },
    en: { major: ['Egyptian pound', 'Egyptian pounds'], minor: ['piaster', 'piasters'] },
    minorUnits: 100,
  },
  SAR: {
    ar: {
      major: {
        one: 'ريال سعودي',
        two: 'ريالان سعوديان',
        few: 'ريالات سعودية',
        many: 'ريالاً سعودياً',
        other: 'ريال سعودي',
      },
      minor: {
        one: 'هللة',
        two: 'هللتان',
        few: 'هللات',
        many: 'هللة',
        other: 'هللة',
        feminine: true,
      },
    },
    en: { major: ['Saudi riyal', 'Saudi riyals'], minor: ['halala', 'halalas'] },
    minorUnits: 100,
  },
  USD: {
    ar: {
      major: {
        one: 'دولار أمريكي',
        two: 'دولاران أمريكيان',
        few: 'دولارات أمريكية',
        many: 'دولاراً أمريكياً',
        other: 'دولار أمريكي',
      },
      minor: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتاً', other: 'سنت' },
    },
    en: { major: ['US dollar', 'US dollars'], minor: ['cent', 'cents'] },
    minorUnits: 100,
  },
  EUR: {
    ar: {
      major: { one: 'يورو', two: 'يورو', few: 'يورو', many: 'يورو', other: 'يورو' },
      minor: { one: 'سنت', two: 'سنتان', few: 'سنتات', many: 'سنتاً', other: 'سنت' },
    },
    en: { major: ['euro', 'euros'], minor: ['cent', 'cents'] },
    minorUnits: 100,
  },
  AED: {
    ar: {
      major: {
        one: 'درهم إماراتي',
        two: 'درهمان إماراتيان',
        few: 'دراهم إماراتية',
        many: 'درهماً إماراتياً',
        other: 'درهم إماراتي',
      },
      minor: { one: 'فلس', two: 'فلسان', few: 'فلوس', many: 'فلساً', other: 'فلس' },
    },
    en: { major: ['UAE dirham', 'UAE dirhams'], minor: ['fils', 'fils'] },
    minorUnits: 100,
  },
};

// ---------------------------------------------------------------- Arabic ----

const AR_ONES_M = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const AR_ONES_F = ['', 'واحدة', 'اثنتان', 'ثلاث', 'أربع', 'خمس', 'ست', 'سبع', 'ثمان', 'تسع', 'عشر'];
const AR_TENS = ['', 'عشرة', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = [
  '',
  'مائة',
  'مائتان',
  'ثلاثمائة',
  'أربعمائة',
  'خمسمائة',
  'ستمائة',
  'سبعمائة',
  'ثمانمائة',
  'تسعمائة',
];

/** Scale words: [singular, dual, plural (3-10), accusative (11-99)]. */
const AR_SCALES: [string, string, string, string][] = [
  ['', '', '', ''],
  ['ألف', 'ألفان', 'آلاف', 'ألفاً'],
  ['مليون', 'مليونان', 'ملايين', 'مليوناً'],
  ['مليار', 'ملياران', 'مليارات', 'ملياراً'],
  ['تريليون', 'تريليونان', 'تريليونات', 'تريليوناً'],
];

/** 1..999 in words. */
function arBelowThousand(n: number, feminine: boolean): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(AR_HUNDREDS[h]);
  if (rest) {
    const ones = feminine ? AR_ONES_F : AR_ONES_M;
    if (rest <= 10) parts.push(ones[rest]);
    else if (rest < 20) {
      const u = rest % 10;
      if (u === 1) parts.push(feminine ? 'إحدى عشرة' : 'أحد عشر');
      else if (u === 2) parts.push(feminine ? 'اثنتا عشرة' : 'اثنا عشر');
      else parts.push(`${ones[u]} ${feminine ? 'عشرة' : 'عشر'}`);
    } else {
      const u = rest % 10;
      const t = Math.floor(rest / 10);
      parts.push(u ? `${u === 1 && feminine ? 'إحدى' : ones[u]} و${AR_TENS[t]}` : AR_TENS[t]);
    }
  }
  return parts.join(' و');
}

/**
 * Construct state (إضافة) of the last number word before the counted noun:
 * مائتان -> مائتا, ألفان -> ألفا, أحد عشر ألفاً -> أحد عشر ألف (مائتا جنيه، ألفا ريال).
 */
function construct(words: string): string {
  if (/(مائتان|ألفان|مليونان|ملياران|تريليونان)$/.test(words)) return words.slice(0, -1);
  if (/(ألفاً|مليوناً|ملياراً|تريليوناً)$/.test(words)) return words.slice(0, -2);
  return words;
}

/** Integer in Arabic words (masculine unless `feminine`). */
export function arabicNumber(value: number, feminine = false): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  if (groups.length > AR_SCALES.length) throw new Error('Number too large');
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (!g) continue;
    if (i === 0) {
      parts.push(arBelowThousand(g, feminine));
      continue;
    }
    const [one, two, few, many] = AR_SCALES[i];
    const last2 = g % 100;
    if (g === 1) parts.push(one);
    else if (g === 2) parts.push(two);
    else if (last2 >= 3 && last2 <= 10) parts.push(`${arBelowThousand(g, false)} ${few}`);
    else if (last2 >= 11) parts.push(`${arBelowThousand(g, false)} ${many}`);
    else parts.push(`${construct(arBelowThousand(g, false))} ${one}`);
  }
  return parts.join(' و');
}

/** Number + counted noun with the Arabic agreement rules. */
function arCounted(n: number, noun: ArNoun): string {
  if (n === 1) return `${noun.one} ${noun.feminine ? 'واحدة' : 'واحد'}`;
  if (n === 2) return noun.two;
  const words = arabicNumber(n, !!noun.feminine);
  const last2 = n % 100;
  if (last2 >= 3 && last2 <= 10) return `${words} ${noun.few}`;
  if (last2 >= 11 && last2 <= 99) return `${words} ${noun.many}`;
  return `${construct(words)} ${noun.other}`;
}

// --------------------------------------------------------------- English ----

const EN_ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function enBelowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(`${EN_ONES[h]} hundred`);
  if (rest) {
    if (rest < 20) parts.push(EN_ONES[rest]);
    else parts.push(EN_TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${EN_ONES[rest % 10]}` : ''));
  }
  return parts.join(' ');
}

/** Integer in English words. */
export function englishNumber(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'zero';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  if (groups.length > EN_SCALES.length) throw new Error('Number too large');
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    parts.push(`${enBelowThousand(groups[i])}${EN_SCALES[i] ? ` ${EN_SCALES[i]}` : ''}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------- Amount ----

function currencyWords(code: string | null | undefined): CurrencyWords {
  const known = CURRENCIES[(code || '').toUpperCase()];
  if (known) return known;
  const c = (code || '').toUpperCase();
  const noun: ArNoun = { one: c, two: c, few: c, many: c, other: c };
  return {
    ar: { major: noun, minor: { one: 'جزء', two: 'جزءان', few: 'أجزاء', many: 'جزءاً', other: 'جزء' } },
    en: { major: [c, c], minor: ['hundredth', 'hundredths'] },
    minorUnits: 100,
  };
}

/** Splits an amount into whole units and minor units (rounded). */
export function splitAmount(amount: number, minorUnits = 100): { major: number; minor: number } {
  const abs = Math.abs(Number(amount) || 0);
  const digits = Math.round(Math.log10(minorUnits));
  const scaled = Math.round(Number((abs * minorUnits).toFixed(Math.max(digits, 2))));
  return { major: Math.floor(scaled / minorUnits), minor: scaled % minorUnits };
}

/**
 * Amount in words, e.g.
 *  ar: "فقط ألف ومائتان وخمسون جنيهاً مصرياً وخمسون قرشاً لا غير"
 *  en: "One thousand two hundred fifty Egyptian pounds and fifty piasters only"
 */
export function amountInWords(amount: number, currencyCode: string | null | undefined, lang: WordsLang): string {
  const cur = currencyWords(currencyCode || 'EGP');
  const { major, minor } = splitAmount(amount, cur.minorUnits);
  const negative = Number(amount) < 0;

  if (lang === 'ar') {
    const parts: string[] = [];
    if (major > 0 || minor === 0) parts.push(major === 0 ? `صفر ${cur.ar.major.other}` : arCounted(major, cur.ar.major));
    if (minor > 0) parts.push(arCounted(minor, cur.ar.minor));
    return `فقط ${negative ? 'سالب ' : ''}${parts.join(' و')} لا غير`;
  }

  const parts: string[] = [];
  if (major > 0 || minor === 0) {
    parts.push(`${englishNumber(major)} ${major === 1 ? cur.en.major[0] : cur.en.major[1]}`);
  }
  if (minor > 0) parts.push(`${englishNumber(minor)} ${minor === 1 ? cur.en.minor[0] : cur.en.minor[1]}`);
  const text = `${negative ? 'minus ' : ''}${parts.join(' and ')} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
