import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marca una ruta como accesible sin `initData` (p. ej. `GET /` para el keep-alive).
 * Todo lo demás exige `Authorization: tma <initDataRaw>` (RNF-SEG-01).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
