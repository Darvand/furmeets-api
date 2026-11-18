import { ValueObject } from './value-object';
import { UUID } from './uuid.value-object';

class Money extends ValueObject<{ amount: number; currency: string }> {}
class Tags extends ValueObject<{ tags: readonly string[] }> {}
class Note extends ValueObject<{ text: string; author?: string }> {}
class Stamp extends ValueObject<{ at: Date }> {}
class Holder extends ValueObject<{ id: UUID; ids?: readonly UUID[] }> {}
class Price extends ValueObject<{ amount: number; currency: string }> {}

describe('ValueObject.equals', () => {
  it('con las mismas props son iguales; con props distintas, no', () => {
    const cop = new Money({ amount: 10, currency: 'COP' });

    expect(cop.equals(new Money({ amount: 10, currency: 'COP' }))).toBe(true);
    expect(cop.equals(new Money({ amount: 11, currency: 'COP' }))).toBe(false);
    expect(cop.equals(new Money({ amount: 10, currency: 'USD' }))).toBe(false);
  });

  it('sin otro (null o undefined) no es igual', () => {
    const cop = new Money({ amount: 10, currency: 'COP' });

    expect(cop.equals(undefined)).toBe(false);
    expect(cop.equals(null as unknown as Money)).toBe(false);
  });

  it('dos clases distintas con las mismas props no son iguales', () => {
    expect(
      new Money({ amount: 10, currency: 'COP' }).equals(
        new Price({ amount: 10, currency: 'COP' }) as unknown as Money,
      ),
    ).toBe(false);
  });

  it('una prop ausente equivale a una en undefined, pero no a un valor', () => {
    expect(
      new Note({ text: 'hola' }).equals(
        new Note({ text: 'hola', author: undefined }),
      ),
    ).toBe(true);
    expect(
      new Note({ text: 'hola' }).equals(
        new Note({ text: 'hola', author: 'Ana' }),
      ),
    ).toBe(false);
  });

  it('compara listas elemento por elemento, en orden', () => {
    const ab = new Tags({ tags: ['a', 'b'] });

    expect(ab.equals(new Tags({ tags: ['a', 'b'] }))).toBe(true);
    expect(ab.equals(new Tags({ tags: ['b', 'a'] }))).toBe(false);
    expect(ab.equals(new Tags({ tags: ['a'] }))).toBe(false);
  });

  it('compara fechas por su instante', () => {
    expect(
      new Stamp({ at: new Date('2026-10-05T00:00:00Z') }).equals(
        new Stamp({ at: new Date('2026-10-05T00:00:00Z') }),
      ),
    ).toBe(true);
    expect(
      new Stamp({ at: new Date('2026-10-05T00:00:00Z') }).equals(
        new Stamp({ at: new Date('2026-10-06T00:00:00Z') }),
      ),
    ).toBe(false);
  });

  it('compara value objects anidados (también en listas) por valor', () => {
    const id = UUID.generate();
    const other = UUID.generate();

    expect(
      new Holder({ id: UUID.from(id.value) }).equals(new Holder({ id })),
    ).toBe(true);
    expect(new Holder({ id }).equals(new Holder({ id: other }))).toBe(false);
    expect(
      new Holder({ id, ids: [UUID.from(other.value)] }).equals(
        new Holder({ id, ids: [other] }),
      ),
    ).toBe(true);
    expect(
      new Holder({ id, ids: [id] }).equals(new Holder({ id, ids: [other] })),
    ).toBe(false);
  });

  it('UUID: el mismo valor es igual; otro, no', () => {
    const id = UUID.generate();

    expect(UUID.from(id.value).equals(id)).toBe(true);
    expect(UUID.generate().equals(id)).toBe(false);
  });
});
