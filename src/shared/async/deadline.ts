export class DeadlineExceededError extends Error {
  constructor(readonly ms: number) {
    super(`Deadline of ${ms}ms exceeded`);
    this.name = DeadlineExceededError.name;
  }
}

/**
 * Espera `promise` como máximo `ms`. Si vence, rechaza con `DeadlineExceededError`,
 * pero la operación original sigue su curso (p. ej. termina de llenar una caché).
 */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineExceededError(ms)), ms);
    timer.unref();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
