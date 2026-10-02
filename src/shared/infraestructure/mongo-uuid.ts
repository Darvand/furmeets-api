import { mongo } from 'mongoose';

/**
 * Normaliza un `_id` de tipo UUID leído de Mongo a su forma de texto.
 *
 * Los documentos de Mongoose aplican el getter del tipo UUID y devuelven un string,
 * pero las lecturas con `lean()` devuelven el valor crudo del driver (`Binary` subtipo 4).
 */
export function toUUIDString(value: string | mongo.Binary): string {
  if (typeof value === 'string') {
    return value;
  }
  return value.toUUID().toHexString();
}

/**
 * Referencia a otro documento por su UUID para guardarla en Mongo.
 *
 * Los esquemas tipan estos campos con la forma poblada (`populate`), pero lo que se
 * guarda es el UUID: este helper hace explícita esa conversión de tipos.
 */
export function uuidRef<T>(uuid: string): T {
  return uuid as unknown as T;
}
