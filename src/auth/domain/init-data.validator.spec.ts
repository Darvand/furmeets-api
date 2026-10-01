import { createHmac } from 'crypto';
import { signInitData } from '../../../test/helpers/init-data';
import {
  INIT_DATA_MAX_AGE_SECONDS,
  InvalidInitDataError,
  InvalidInitDataReason,
  validateInitData,
} from './init-data.validator';

const BOT_TOKEN = '123456:TEST-TOKEN';
const USER = { id: 42, first_name: 'Ana', last_name: 'Gómez', username: 'ana' };
const NOW = new Date(1_700_000_000 * 1000);

function expectReason(fn: () => unknown, reason: InvalidInitDataReason) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInitDataError);
    expect((error as InvalidInitDataError).reason).toBe(reason);
    return;
  }
  throw new Error(`Se esperaba InvalidInitDataError(${reason})`);
}

/** Reemplaza un campo del query string sin volver a firmar. */
function tamper(initData: string, key: string, value: string | null): string {
  const params = new URLSearchParams(initData);
  if (value === null) params.delete(key);
  else params.set(key, value);
  return params.toString();
}

describe('validateInitData', () => {
  it('acepta un initData firmado y devuelve el usuario y la fecha', () => {
    const initData = signInitData(USER, BOT_TOKEN, {
      authDate: NOW,
      extra: { query_id: 'AAE', chat_instance: '-123' },
    });

    const result = validateInitData(initData, BOT_TOKEN, { now: NOW });

    expect(result.user).toEqual({ ...USER, photo_url: undefined });
    expect(result.authDate).toEqual(NOW);
  });

  it('acepta un initData con justo 24 h de antigüedad', () => {
    const initData = signInitData(USER, BOT_TOKEN, { authDate: NOW });
    const now = new Date(NOW.getTime() + INIT_DATA_MAX_AGE_SECONDS * 1000);

    expect(() => validateInitData(initData, BOT_TOKEN, { now })).not.toThrow();
  });

  it('rechaza un initData vencido (más de 24 h)', () => {
    const initData = signInitData(USER, BOT_TOKEN, { authDate: NOW });
    const now = new Date(
      NOW.getTime() + (INIT_DATA_MAX_AGE_SECONDS + 1) * 1000,
    );

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now }),
      'expired',
    );
  });

  it('rechaza un initData sin hash', () => {
    const initData = tamper(
      signInitData(USER, BOT_TOKEN, { authDate: NOW }),
      'hash',
      null,
    );

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'missing-hash',
    );
  });

  it('rechaza una cadena vacía', () => {
    expectReason(
      () => validateInitData('', BOT_TOKEN, { now: NOW }),
      'missing-hash',
    );
  });

  it('rechaza un usuario alterado', () => {
    const initData = tamper(
      signInitData(USER, BOT_TOKEN, { authDate: NOW }),
      'user',
      JSON.stringify({ ...USER, id: 43 }),
    );

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-signature',
    );
  });

  it('rechaza un auth_date alterado (no se puede extender la vigencia)', () => {
    const initData = tamper(
      signInitData(USER, BOT_TOKEN, { authDate: NOW }),
      'auth_date',
      String(NOW.getTime() / 1000 + 3600),
    );

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-signature',
    );
  });

  it('rechaza un campo agregado después de firmar', () => {
    const initData = tamper(
      signInitData(USER, BOT_TOKEN, { authDate: NOW }),
      'query_id',
      'AAE',
    );

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-signature',
    );
  });

  it('rechaza un initData firmado con otro token', () => {
    const initData = signInitData(USER, 'otro:token', { authDate: NOW });

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-signature',
    );
  });

  it('rechaza un hash que no es hex de 32 bytes', () => {
    const initData = tamper(
      signInitData(USER, BOT_TOKEN, { authDate: NOW }),
      'hash',
      'abc',
    );

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-signature',
    );
  });

  it('rechaza un initData firmado sin usuario', () => {
    const initData = signedFields({ auth_date: String(NOW.getTime() / 1000) });

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-user',
    );
  });

  it('rechaza un usuario firmado pero sin id numérico', () => {
    const initData = signedFields({
      auth_date: String(NOW.getTime() / 1000),
      user: JSON.stringify({ id: '42', first_name: 'Ana' }),
    });

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'invalid-user',
    );
  });

  it('rechaza un initData firmado sin auth_date', () => {
    const initData = signedFields({ user: JSON.stringify(USER) });

    expectReason(
      () => validateInitData(initData, BOT_TOKEN, { now: NOW }),
      'missing-auth-date',
    );
  });
});

/** Firma campos arbitrarios con el algoritmo de Telegram (para casos que `signInitData` no genera). */
function signedFields(fields: Record<string, string>): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(BOT_TOKEN)
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
