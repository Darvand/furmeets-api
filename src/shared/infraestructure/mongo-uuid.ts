import { mongo } from "mongoose";

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
