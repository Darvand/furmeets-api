export interface TtlCacheOptions {
  ttlMs: number;
  /** Tope de entradas; al superarlo se descarta la más antigua. */
  maxEntries: number;
  /** Reloj inyectable para pruebas. */
  now?: () => number;
}

/**
 * Caché en memoria con vencimiento por entrada y tamaño acotado (el servidor tiene
 * poca memoria). `getOrLoad` además comparte la carga en curso: N peticiones
 * simultáneas por la misma clave hacen una sola llamada. Los errores no se guardan.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();
  private readonly inFlight = new Map<K, Promise<V>>();
  private readonly now: () => number;

  constructor(private readonly options: TtlCacheOptions) {
    this.now = options.now ?? Date.now;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: this.now() + this.options.ttlMs,
    });
    if (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as K;
      this.entries.delete(oldest);
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  getOrLoad(key: K, load: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const loading = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, loading);
    return loading;
  }
}
