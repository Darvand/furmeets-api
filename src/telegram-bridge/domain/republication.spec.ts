import {
  CAPTION_MAX_LENGTH,
  republicationOf,
  TEXT_MAX_LENGTH,
} from './republication';

const base = {
  requesterName: 'Ana_*fur*',
  link: 'https://t.me/bot/app?startapp=abc',
  content: 'hola, soy _nueva_',
  hasImages: false,
};

describe('republicationOf', () => {
  it('lleva el encabezado "Nombre · solicitud" en negrita y con el enlace', () => {
    const { head, overflow } = republicationOf(base);

    expect(head.text).toBe('Ana_*fur* · solicitud\nhola, soy _nueva_');
    const length = 'Ana_*fur* · solicitud'.length;
    expect(head.entities).toEqual([
      { type: 'bold', offset: 0, length },
      { type: 'text_link', offset: 0, length, url: base.link },
    ]);
    expect(overflow).toBeUndefined();
  });

  it('con solo imágenes, el pie es el encabezado', () => {
    const { head, overflow } = republicationOf({
      ...base,
      content: '',
      hasImages: true,
    });

    expect(head.text).toBe('Ana_*fur* · solicitud');
    expect(overflow).toBeUndefined();
  });

  it('con imágenes y texto corto, el texto va en el pie', () => {
    const { head, overflow } = republicationOf({ ...base, hasImages: true });

    expect(head.text).toContain('hola, soy _nueva_');
    expect(overflow).toBeUndefined();
  });

  it('con imágenes y un texto que no cabe en el pie, el texto va aparte', () => {
    const content = 'a'.repeat(CAPTION_MAX_LENGTH);
    const { head, overflow } = republicationOf({
      ...base,
      content,
      hasImages: true,
    });

    expect(head.text).toBe('Ana_*fur* · solicitud');
    expect(overflow).toEqual({ text: content, entities: [] });
  });

  it('recorta un texto que no cabe en un mensaje', () => {
    const { head } = republicationOf({
      ...base,
      content: 'a'.repeat(TEXT_MAX_LENGTH),
    });

    expect(head.text.length).toBe(TEXT_MAX_LENGTH);
    expect(head.text.endsWith('a…')).toBe(true);
  });

  it('al recortar no parte un emoji', () => {
    const room = TEXT_MAX_LENGTH - 'Ana · solicitud\n'.length;
    // El corte caería en medio del par sustituto de "😀".
    const { head } = republicationOf({
      ...base,
      requesterName: 'Ana',
      content: `${'a'.repeat(room - 2)}😀😀`,
    });

    expect(head.text.endsWith('a…')).toBe(true);
    expect(head.text).not.toMatch(/[\ud800-\udbff]…$/);
  });
});
