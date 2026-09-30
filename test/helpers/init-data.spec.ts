import { signInitData } from './init-data';

const BOT_TOKEN = '123456:TEST-TOKEN';
const USER = { id: 42, first_name: 'Ana' };
const AUTH_DATE = new Date(1_700_000_000 * 1000);

describe('signInitData', () => {
  it('firma igual que la referencia de Telegram (vector calculado con .NET HMACSHA256)', () => {
    const initData = signInitData(USER, BOT_TOKEN, { authDate: AUTH_DATE });
    const params = new URLSearchParams(initData);

    expect(params.get('hash')).toBe(
      '5218f0a88fdbe54bedcd955d87751ffb69214ea8b6bcaa37f076be0ee7d2ee7a',
    );
  });

  it('incluye auth_date en segundos y el usuario como JSON', () => {
    const params = new URLSearchParams(
      signInitData(USER, BOT_TOKEN, { authDate: AUTH_DATE }),
    );

    expect(params.get('auth_date')).toBe('1700000000');
    expect(JSON.parse(params.get('user')!)).toEqual(USER);
  });

  it('usa la fecha actual por defecto', () => {
    const before = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams(signInitData(USER, BOT_TOKEN));

    expect(Number(params.get('auth_date'))).toBeGreaterThanOrEqual(before);
  });

  it('cambia la firma si cambia el token, el usuario o los campos extra', () => {
    const hashOf = (initData: string) =>
      new URLSearchParams(initData).get('hash');
    const base = hashOf(signInitData(USER, BOT_TOKEN, { authDate: AUTH_DATE }));

    expect(
      hashOf(signInitData(USER, 'otro:token', { authDate: AUTH_DATE })),
    ).not.toBe(base);
    expect(
      hashOf(
        signInitData({ ...USER, id: 43 }, BOT_TOKEN, { authDate: AUTH_DATE }),
      ),
    ).not.toBe(base);
    expect(
      hashOf(
        signInitData(USER, BOT_TOKEN, {
          authDate: AUTH_DATE,
          extra: { query_id: 'AAE' },
        }),
      ),
    ).not.toBe(base);
  });

  it('incluye los campos extra en el initData', () => {
    const params = new URLSearchParams(
      signInitData(USER, BOT_TOKEN, { extra: { query_id: 'AAE' } }),
    );

    expect(params.get('query_id')).toBe('AAE');
  });
});
