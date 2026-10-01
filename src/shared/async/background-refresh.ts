import { Logger } from '@nestjs/common';
import { TtlCache } from '../cache/ttl-cache';

/**
 * Ejecuta refrescos en segundo plano (fotos, info del grupo) sin que ninguna petición
 * los espere, y como máximo una vez por clave cada `ttlMs`. Si un refresco falla, se
 * registra en `warn` y la clave queda libre para reintentar en la siguiente petición.
 */
export class BackgroundRefresh {
  private readonly recent: TtlCache<string, true>;

  constructor(
    ttlMs: number,
    private readonly logger: Logger,
    maxEntries = 1_000,
  ) {
    this.recent = new TtlCache({ ttlMs, maxEntries });
  }

  /**
   * Programa `task` si `key` no se refrescó dentro del TTL. Devuelve la promesa del
   * refresco (que nunca rechaza) solo para que las pruebas puedan esperarla; el código
   * de producción la ignora.
   */
  schedule(key: string, task: () => Promise<void>): Promise<void> | undefined {
    if (this.recent.has(key)) return undefined;
    this.recent.set(key, true);
    return task().catch((error: unknown) => {
      this.recent.delete(key);
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Refresco en segundo plano fallido (${key}): ${reason}`);
    });
  }
}
