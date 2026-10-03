import { detectImageType } from './image-type';

const bytes = (...values: (number | string)[]) =>
  Buffer.concat(
    values.map((v) =>
      typeof v === 'string' ? Buffer.from(v, 'ascii') : Buffer.from([v]),
    ),
  );

describe('detectImageType', () => {
  it('reconoce JPEG, PNG y WebP por sus primeros bytes', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0))).toBe(
      'image/jpeg',
    );
    expect(detectImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      'image/png',
    );
    expect(detectImageType(bytes('RIFF', 1, 2, 3, 4, 'WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it('rechaza otros formatos aunque se llamen como imagen', () => {
    expect(detectImageType(bytes('GIF89a'))).toBeUndefined();
    expect(
      detectImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBeUndefined();
    expect(detectImageType(bytes('RIFF', 1, 2, 3, 4, 'WAVE'))).toBeUndefined();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeUndefined();
    expect(detectImageType(Buffer.alloc(0))).toBeUndefined();
  });
});
