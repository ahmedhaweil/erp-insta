import { decodeTlv, encodeTlv, zatcaQr } from './zatca-tlv';

describe('ZATCA QR TLV', () => {
  it('matches the ZATCA phase-1 guideline sample', () => {
    const qr = zatcaQr({
      sellerName: 'Bobs Records',
      vatNumber: '310122393500003',
      timestamp: '2022-04-25T15:30:00Z',
      totalWithVat: '1000.00',
      vatTotal: '150.00',
    });
    expect(qr).toBe(
      'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==',
    );
  });

  it('formats numeric amounts with two decimals', () => {
    const fields = decodeTlv(
      zatcaQr({ sellerName: 'S', vatNumber: '1', timestamp: 't', totalWithVat: 1150, vatTotal: 150 }),
    );
    expect(fields.map((f) => f.value.toString())).toEqual(['S', '1', 't', '1150.00', '150.00']);
  });

  it('measures lengths in UTF-8 bytes (Arabic seller names)', () => {
    const buf = encodeTlv([{ tag: 1, value: 'شركة' }]);
    expect(buf[0]).toBe(1);
    expect(buf[1]).toBe(8);
    expect(decodeTlv(buf)[0].value.toString('utf8')).toBe('شركة');
  });

  it('adds phase-2 tags 6-9 with binary public key and certificate signature', () => {
    const publicKey = Buffer.from([0x30, 0x56, 0x01]);
    const certSig = Buffer.from([0x30, 0x44, 0xff]);
    const fields = decodeTlv(
      zatcaQr({
        sellerName: 'S',
        vatNumber: '300000000000003',
        timestamp: '2022-09-07T12:21:28',
        totalWithVat: '115.00',
        vatTotal: '15.00',
        invoiceHash: 'aGFzaA==',
        signature: 'c2ln',
        publicKey,
        certificateSignature: certSig,
      }),
    );
    expect(fields.map((f) => f.tag)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(fields[5].value.toString()).toBe('aGFzaA==');
    expect(fields[7].value.equals(publicKey)).toBe(true);
    expect(fields[8].value.equals(certSig)).toBe(true);
  });

  it('rejects values longer than 255 bytes and malformed input', () => {
    expect(() => encodeTlv([{ tag: 1, value: 'x'.repeat(256) }])).toThrow();
    expect(() => decodeTlv(Buffer.from([1, 5, 65]))).toThrow();
  });
});
