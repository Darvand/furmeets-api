/**
 * Reloj que nunca repite ni retrocede: cada `now()` es al menos 1 ms posterior al
 * anterior. Así los mensajes enviados en el mismo milisegundo quedan en el orden en que
 * llegaron al servidor al ordenar por `createdAt` (RNF-CON-01). Vale para una sola
 * instancia de la API, que es lo que corre hoy (Render free).
 */
export class MonotonicClock {
  private last = 0;

  constructor(private readonly source: () => number = Date.now) {}

  now(): Date {
    this.last = Math.max(this.source(), this.last + 1);
    return new Date(this.last);
  }
}
