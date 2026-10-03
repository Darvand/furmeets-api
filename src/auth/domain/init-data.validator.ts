import { createHmac, timingSafeEqual } from 'crypto';

/** Vigencia máxima de un `initData` (RNF-SEG-01): 24 h desde `auth_date`. */
export const INIT_DATA_MAX_AGE_SECONDS = 24 * 60 * 60;

/** Usuario tal como lo envía Telegram dentro de `initData.user`. */
export interface InitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export interface ValidInitData {
  user: InitDataUser;
  authDate: Date;
}

export type InvalidInitDataReason =
  | 'missing'
  | 'missing-hash'
  | 'invalid-signature'
  | 'missing-auth-date'
  | 'expired'
  | 'invalid-user';

export class InvalidInitDataError extends Error {
  constructor(readonly reason: InvalidInitDataReason) {
    super(`Invalid initData: ${reason}`);
    this.name = InvalidInitDataError.name;
  }
}

export interface ValidateInitDataOptions {
  /** Momento de referencia para la vigencia. Por defecto, ahora. */
  now?: Date;
  maxAgeSeconds?: number;
}

/**
 * Valida el `initData` de una Mini App de Telegram:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * - secret_key = HMAC_SHA256(key = "WebAppData", data = botToken)
 * - data_check_string = pares `key=value` (sin `hash`) ordenados por key y unidos con "\n"
 * - hash esperado = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 *
 * Función pura (sin Nest ni BD) para reutilizarla en HTTP y en el socket.
 * Lanza `InvalidInitDataError` con el motivo; nunca incluye el `initData` en el error.
 */
export function validateInitData(
  initDataRaw: string,
  botToken: string,
  options: ValidateInitDataOptions = {},
): ValidInitData {
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');
  if (!hash) {
    throw new InvalidInitDataError('missing-hash');
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const expected = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest();
  const received = Buffer.from(hash, 'hex');
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw new InvalidInitDataError('invalid-signature');
  }

  const authDateSeconds = Number(params.get('auth_date'));
  if (!Number.isInteger(authDateSeconds) || authDateSeconds <= 0) {
    throw new InvalidInitDataError('missing-auth-date');
  }
  const nowSeconds = (options.now ?? new Date()).getTime() / 1000;
  const maxAge = options.maxAgeSeconds ?? INIT_DATA_MAX_AGE_SECONDS;
  if (nowSeconds - authDateSeconds > maxAge) {
    throw new InvalidInitDataError('expired');
  }

  return {
    user: parseUser(params.get('user')),
    authDate: new Date(authDateSeconds * 1000),
  };
}

function parseUser(rawUser: string | null): InitDataUser {
  if (!rawUser) {
    throw new InvalidInitDataError('invalid-user');
  }
  let user: unknown;
  try {
    user = JSON.parse(rawUser);
  } catch {
    throw new InvalidInitDataError('invalid-user');
  }
  if (!isInitDataUser(user)) {
    throw new InvalidInitDataError('invalid-user');
  }
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: optionalString(user.last_name),
    username: optionalString(user.username),
    photo_url: optionalString(user.photo_url),
  };
}

function isInitDataUser(value: unknown): value is InitDataUser {
  if (typeof value !== 'object' || value === null) return false;
  const user = value as Record<string, unknown>;
  return Number.isSafeInteger(user.id) && typeof user.first_name === 'string';
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
