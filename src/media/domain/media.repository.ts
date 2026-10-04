import type { MediaItem } from './media';

export const MEDIA_REPOSITORY = Symbol('MediaRepository');

export interface MediaRepository {
  findById(id: string): Promise<MediaItem | null>;

  /** Las que existen de esos ids, en cualquier orden. */
  findByIds(ids: readonly string[]): Promise<MediaItem[]>;

  create(media: MediaItem): Promise<void>;

  /**
   * Registra un archivo de Telegram una sola vez por tipo y `fileUniqueId` (sincronizar
   * el mismo avatar no crea otro registro ni escribe) y devuelve su id.
   */
  registerOnce(media: MediaItem): Promise<string>;
}
