export const MediaKinds = Object.freeze({
  /** Foto de perfil de un usuario, tomada de Telegram. */
  Avatar: 'avatar',
  /** Foto del grupo, tomada de Telegram. */
  GroupPhoto: 'group-photo',
  /** Imagen subida por un usuario (formulario, chat). */
  Upload: 'upload',
} as const);

export type MediaKind = (typeof MediaKinds)[keyof typeof MediaKinds];

/** Una imagen guardada en Telegram. Se sirve por `GET /media/:id`, nunca por su URL de Telegram. */
export interface MediaItem {
  id: string;
  kind: MediaKind;
  /** Para pedir el archivo a Telegram (`getFile`) o reenviarlo sin volver a subirlo. */
  fileId: string;
  /** Estable entre llamadas y bots: identifica el archivo, pero no sirve para descargarlo. */
  fileUniqueId: string;
  /** Quien la subió, o el dueño del avatar. */
  ownerId?: string;
  mimeType: string;
}

/** Lo que devuelve Telegram de una foto (`PhotoSize`). */
export interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
}

/** Telegram recomprime toda foto (subida con `sendPhoto` o de perfil) a JPEG. */
export const TELEGRAM_PHOTO_MIME_TYPE = 'image/jpeg';

/**
 * Quién ve una imagen (RNF-SEG-04). Un miembro ve todas. Cualquier usuario autenticado
 * ve avatares y la foto del grupo: el solicitante los necesita en su chat y en el
 * formulario. Una imagen subida solo la ve quien la subió (T14 y T17 la abren a los
 * participantes de su solicitud).
 *
 * Decide lo que se puede sin el rol, para no consultarlo en el caso común: si devuelve
 * `false`, solo un miembro puede verla.
 */
export function visibleWithoutRole(
  media: Pick<MediaItem, 'kind' | 'ownerId'>,
  userId: string,
): boolean {
  return media.kind !== MediaKinds.Upload || media.ownerId === userId;
}
