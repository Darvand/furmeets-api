import { createHmac } from 'crypto';

/** Usuario tal como lo envía Telegram dentro de `initData.user`. */
export interface TelegramInitDataUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface SignInitDataOptions {
  /** Fecha de firma. Por defecto, ahora. Útil para probar `auth_date` vencido. */
  authDate?: Date;
  /** Campos extra de `initData` (p. ej. `query_id`, `chat_instance`). */
  extra?: Record<string, string>;
}

/**
 * Genera un `initData` de Telegram Mini App firmado como lo hace Telegram:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * - secret_key = HMAC_SHA256(key = "WebAppData", data = botToken)
 * - data_check_string = pares `key=value` (sin `hash`) ordenados por key y unidos con "\n"
 * - hash = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 *
 * Devuelve el query string listo para `Authorization: tma <initData>`.
 */
export function signInitData(
  user: TelegramInitDataUser,
  botToken: string,
  options: SignInitDataOptions = {},
): string {
  const authDate = options.authDate ?? new Date();
  const fields: Record<string, string> = {
    ...options.extra,
    auth_date: Math.floor(authDate.getTime() / 1000).toString(),
    user: JSON.stringify(user),
  };

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}
