import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  let now: number;
  const cache = (maxEntries = 10) =>
    new TtlCache<string, number>({ ttlMs: 1_000, maxEntries, now: () => now });

  beforeEach(() => {
    now = 0;
  });

  it('devuelve el valor dentro del TTL y lo olvida al vencer', () => {
    const c = cache();
    c.set('a', 1);

    now = 999;
    expect(c.get('a')).toBe(1);
    now = 1_000;
    expect(c.get('a')).toBeUndefined();
  });

  it('descarta la entrada más antigua al superar el tope', () => {
    const c = cache(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3);

    expect(c.has('a')).toBe(false);
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('getOrLoad comparte la carga en curso y luego usa la caché', async () => {
    const c = cache();
    const load = jest.fn().mockResolvedValue(7);

    const results = await Promise.all([
      c.getOrLoad('a', load),
      c.getOrLoad('a', load),
    ]);
    expect(await c.getOrLoad('a', load)).toBe(7);

    expect(results).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('getOrLoad vuelve a cargar cuando vence', async () => {
    const c = cache();
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await c.getOrLoad('a', load);
    now = 1_000;

    expect(await c.getOrLoad('a', load)).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('getOrLoad no guarda errores', async () => {
    const c = cache();
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('telegram caído'))
      .mockResolvedValueOnce(3);

    await expect(c.getOrLoad('a', load)).rejects.toThrow('telegram caído');
    expect(await c.getOrLoad('a', load)).toBe(3);
  });
});
