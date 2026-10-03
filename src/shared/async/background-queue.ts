import { Logger, OnModuleDestroy } from '@nestjs/common';
import { runWithoutTiming } from '../timing/timing-context';
import { DeadlineExceededError, withDeadline } from './deadline';

export interface BackgroundQueueOptions {
  /** Intentos por tarea, contando el primero. */
  attempts: number;
  /** Antes del intento `n + 1` se espera `retryDelayMs * n`. */
  retryDelayMs: number;
  /** Tareas pendientes como máximo: las que no caben se descartan con un error. */
  maxPending: number;
  /** Cuánto espera el apagado a que se vacíe la cola. */
  drainTimeoutMs: number;
}

const DEFAULTS: BackgroundQueueOptions = {
  attempts: 3,
  retryDelayMs: 1_000,
  maxPending: 1_000,
  drainTimeoutMs: 5_000,
};

/**
 * Cola en memoria para los efectos secundarios que ninguna petición debe esperar, como
 * los avisos de Telegram (RNF-REN-08). Ejecuta las tareas de a una y en orden de llegada,
 * fuera del contexto de medición de la petición que las encoló. Reintenta cada tarea
 * hasta `attempts` veces; si se agotan, registra el error y sigue con la siguiente.
 *
 * Lo encolado se pierde si el proceso se reinicia: sirve para avisos, nunca para datos
 * que deban quedar guardados.
 */
export class BackgroundQueue implements OnModuleDestroy {
  private readonly options: BackgroundQueueOptions;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly logger: Logger,
    options: Partial<BackgroundQueueOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Encola `task` y vuelve de inmediato. `name` identifica la tarea en los logs. */
  enqueue(
    name: string,
    task: () => Promise<void>,
    { attempts = this.options.attempts }: { attempts?: number } = {},
  ): void {
    if (this.pending >= this.options.maxPending) {
      this.logger.error(`Cola llena: se descarta la tarea "${name}"`);
      return;
    }
    this.pending++;
    runWithoutTiming(() => {
      this.tail = this.tail
        .then(() => this.run(name, task, attempts))
        .finally(() => this.pending--);
    });
  }

  /** Espera a que terminen todas las tareas, incluidas las que se encolen mientras tanto. */
  async drain(): Promise<void> {
    let tail: Promise<void>;
    do {
      tail = this.tail;
      await tail;
    } while (tail !== this.tail);
  }

  /** Al apagar, da a las tareas pendientes un tiempo acotado para terminar. */
  async onModuleDestroy(): Promise<void> {
    try {
      await withDeadline(this.drain(), this.options.drainTimeoutMs);
    } catch (error) {
      if (!(error instanceof DeadlineExceededError)) throw error;
      this.logger.warn(
        `Apagado con ${this.pending} tareas en segundo plano sin terminar`,
      );
    }
  }

  /** Nunca rechaza: así una tarea fallida no corta la cola. */
  private async run(
    name: string,
    task: () => Promise<void>,
    attempts: number,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await task();
        return;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (attempt >= attempts) {
          this.logger.error(
            `Tarea en segundo plano fallida tras ${attempt} intento(s) (${name}): ${reason}`,
          );
          return;
        }
        this.logger.warn(
          `Tarea en segundo plano fallida (${name}), se reintenta: ${reason}`,
        );
        await sleep(this.options.retryDelayMs * attempt);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
