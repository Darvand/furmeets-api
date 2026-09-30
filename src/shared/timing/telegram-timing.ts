import type { Transformer } from 'grammy';
import { currentTiming, elapsedMs, recordTelegram } from './timing-context';

/**
 * Transformer de grammy que suma la duración de cada llamada a la API de Telegram
 * al contexto de la petición en curso. Fuera de una petición (polling del bot) no hace nada.
 */
export const telegramTimingTransformer: Transformer = async (
  prev,
  method,
  payload,
  signal,
) => {
  const store = currentTiming();
  if (!store) return prev(method, payload, signal);
  const startedAt = process.hrtime.bigint();
  try {
    return await prev(method, payload, signal);
  } finally {
    recordTelegram(elapsedMs(startedAt), store);
  }
};
