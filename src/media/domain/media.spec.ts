import { MediaKinds, visibleWithoutRole } from './media';

describe('visibleWithoutRole', () => {
  it('avatares y foto del grupo los ve cualquier usuario autenticado', () => {
    expect(
      visibleWithoutRole({ kind: MediaKinds.Avatar, ownerId: 'otro' }, 'yo'),
    ).toBe(true);
    expect(visibleWithoutRole({ kind: MediaKinds.GroupPhoto }, 'yo')).toBe(
      true,
    );
  });

  it('una imagen subida la ve sin rol solo quien la subió', () => {
    expect(
      visibleWithoutRole({ kind: MediaKinds.Upload, ownerId: 'yo' }, 'yo'),
    ).toBe(true);
    expect(
      visibleWithoutRole({ kind: MediaKinds.Upload, ownerId: 'otro' }, 'yo'),
    ).toBe(false);
    expect(visibleWithoutRole({ kind: MediaKinds.Upload }, 'yo')).toBe(false);
  });
});
