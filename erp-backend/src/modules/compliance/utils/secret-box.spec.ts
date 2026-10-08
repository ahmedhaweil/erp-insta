import { maskSecret, SecretBox } from './secret-box';

describe('SecretBox', () => {
  it('encrypts and decrypts with AES-GCM when a key is configured', () => {
    const box = new SecretBox('k1');
    const sealed = box.seal('client-secret')!;
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('client-secret');
    expect(box.open(sealed)).toBe('client-secret');
    expect(box.seal(sealed)).toBe(sealed); // idempotent
  });

  it('stores values as given without a key and still reads plaintext later', () => {
    expect(new SecretBox(undefined).seal('x')).toBe('x');
    expect(new SecretBox('k1').open('legacy-plain')).toBe('legacy-plain');
  });

  it('refuses to decrypt with the wrong or no key', () => {
    const sealed = new SecretBox('k1').seal('x')!;
    expect(() => new SecretBox('k2').open(sealed)).toThrow();
    expect(() => new SecretBox(undefined).open(sealed)).toThrow();
  });

  it('masks secrets', () => {
    expect(maskSecret('abc')).toBe('********');
    expect(maskSecret(null)).toBeNull();
  });
});
