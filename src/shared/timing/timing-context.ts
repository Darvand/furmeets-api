import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Tiempos acumulados de una petición HTTP o de un evento de socket (RNF-OBS-03).
 *
 * El contexto viaja con `AsyncLocalStorage`, así que cualquier llamada a Mongo o a
 * Telegram hecha mientras se atiende la petición suma su duración aquí sin tener que
 * pasar nada por parámetro. Los tiempos son acumulados: si dos operaciones corren en
 * paralelo, la suma puede superar la duración total.
 */
export interface TimingStore {
  mongoMs: number;
  mongoOps: number;
  telegramMs: number;
  telegramCalls: number;
}

const storage = new AsyncLocalStorage<TimingStore>();

export function createTimingStore(): TimingStore {
  return { mongoMs: 0, mongoOps: 0, telegramMs: 0, telegramCalls: 0 };
}

/** Ejecuta `fn` dentro de un contexto de medición. */
export function runWithTiming<T>(store: TimingStore, fn: () => T): T {
  return storage.run(store, fn);
}

/**
 * Ejecuta `fn` fuera de cualquier contexto de medición: lo que se programe dentro
 * (p. ej. tareas en segundo plano) no suma a la petición que lo originó.
 */
export function runWithoutTiming<T>(fn: () => T): T {
  return storage.exit(fn);
}

/** Contexto de la petición en curso, o `undefined` si no hay ninguna (p. ej. el polling del bot). */
export function currentTiming(): TimingStore | undefined {
  return storage.getStore();
}

export function recordMongo(
  ms: number,
  store: TimingStore | undefined = currentTiming(),
): void {
  if (!store) return;
  store.mongoMs += ms;
  store.mongoOps += 1;
}

export function recordTelegram(
  ms: number,
  store: TimingStore | undefined = currentTiming(),
): void {
  if (!store) return;
  store.telegramMs += ms;
  store.telegramCalls += 1;
}

export function elapsedMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

/** Ej.: `GET /request-chats/:id 200 132ms (mongo 95ms/3 · telegram 0ms/0)`. Sin datos personales. */
export function formatTiming(
  label: string,
  totalMs: number,
  store: TimingStore,
): string {
  const mongo = `mongo ${Math.round(store.mongoMs)}ms/${store.mongoOps}`;
  const telegram = `telegram ${Math.round(store.telegramMs)}ms/${store.telegramCalls}`;
  return `${label} ${Math.round(totalMs)}ms (${mongo} · ${telegram})`;
}
