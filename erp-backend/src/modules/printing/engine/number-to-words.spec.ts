import { amountInWords, arabicNumber, englishNumber, splitAmount } from './number-to-words';

describe('number-to-words', () => {
  describe('Arabic numbers', () => {
    it.each([
      [0, 'صفر'],
      [1, 'واحد'],
      [12, 'اثنا عشر'],
      [21, 'واحد وعشرون'],
      [100, 'مائة'],
      [200, 'مائتان'],
      [305, 'ثلاثمائة وخمسة'],
      [1000, 'ألف'],
      [2000, 'ألفان'],
      [3000, 'ثلاثة آلاف'],
      [11000, 'أحد عشر ألفاً'],
      [105000, 'مائة وخمسة آلاف'],
      [200000, 'مائتا ألف'],
      [1999, 'ألف وتسعمائة وتسعة وتسعون'],
      [2500000, 'مليونان وخمسمائة ألف'],
      [3000000000, 'ثلاثة مليارات'],
    ])('%d -> %s', (n, words) => {
      expect(arabicNumber(n)).toBe(words);
    });

    it('uses feminine forms for feminine nouns', () => {
      expect(arabicNumber(3, true)).toBe('ثلاث');
      expect(arabicNumber(11, true)).toBe('إحدى عشرة');
      expect(arabicNumber(12, true)).toBe('اثنتا عشرة');
      expect(arabicNumber(21, true)).toBe('إحدى وعشرون');
    });
  });

  describe('English numbers', () => {
    it.each([
      [0, 'zero'],
      [15, 'fifteen'],
      [42, 'forty-two'],
      [100, 'one hundred'],
      [1999, 'one thousand nine hundred ninety-nine'],
      [2500000, 'two million five hundred thousand'],
    ])('%d -> %s', (n, words) => {
      expect(englishNumber(n)).toBe(words);
    });
  });

  it('splits amounts into units and minor units without float drift', () => {
    expect(splitAmount(1234.5)).toEqual({ major: 1234, minor: 50 });
    expect(splitAmount(0.29)).toEqual({ major: 0, minor: 29 });
    expect(splitAmount(1.005)).toEqual({ major: 1, minor: 1 });
    expect(splitAmount(59427.85)).toEqual({ major: 59427, minor: 85 });
  });

  describe('EGP', () => {
    it.each([
      [1, 'فقط جنيه مصري واحد لا غير'],
      [2, 'فقط جنيهان مصريان لا غير'],
      [3, 'فقط ثلاثة جنيهات مصرية لا غير'],
      [11, 'فقط أحد عشر جنيهاً مصرياً لا غير'],
      [100, 'فقط مائة جنيه مصري لا غير'],
      [200, 'فقط مائتا جنيه مصري لا غير'],
      [2000, 'فقط ألفا جنيه مصري لا غير'],
      [11000, 'فقط أحد عشر ألف جنيه مصري لا غير'],
      [12500.75, 'فقط اثنا عشر ألفاً وخمسمائة جنيه مصري وخمسة وسبعون قرشاً لا غير'],
      [1234.5, 'فقط ألف ومائتان وأربعة وثلاثون جنيهاً مصرياً وخمسون قرشاً لا غير'],
      [0.5, 'فقط خمسون قرشاً لا غير'],
      [0, 'فقط صفر جنيه مصري لا غير'],
    ])('ar %d', (n, words) => {
      expect(amountInWords(n, 'EGP', 'ar')).toBe(words);
    });

    it('en', () => {
      expect(amountInWords(1234.5, 'EGP', 'en')).toBe(
        'One thousand two hundred thirty-four Egyptian pounds and fifty piasters only',
      );
      expect(amountInWords(1.01, 'EGP', 'en')).toBe('One Egyptian pound and one piaster only');
    });
  });

  describe('SAR', () => {
    it.each([
      [0.01, 'فقط هللة واحدة لا غير'],
      [1.01, 'فقط ريال سعودي واحد وهللة واحدة لا غير'],
      [3.03, 'فقط ثلاثة ريالات سعودية وثلاث هللات لا غير'],
      [12.12, 'فقط اثنا عشر ريالاً سعودياً واثنتا عشرة هللة لا غير'],
      [21.21, 'فقط واحد وعشرون ريالاً سعودياً وإحدى وعشرون هللة لا غير'],
      [345, 'فقط ثلاثمائة وخمسة وأربعون ريالاً سعودياً لا غير'],
    ])('ar %d', (n, words) => {
      expect(amountInWords(n, 'SAR', 'ar')).toBe(words);
    });

    it('en', () => {
      expect(amountInWords(345.5, 'SAR', 'en')).toBe('Three hundred forty-five Saudi riyals and fifty halalas only');
      expect(amountInWords(1, 'SAR', 'en')).toBe('One Saudi riyal only');
    });
  });

  it('defaults to EGP and handles unknown currencies', () => {
    expect(amountInWords(5, null, 'en')).toBe('Five Egyptian pounds only');
    expect(amountInWords(5, 'XYZ', 'en')).toBe('Five XYZ only');
  });
});
