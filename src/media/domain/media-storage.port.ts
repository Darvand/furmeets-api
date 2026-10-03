import type { Readable } from 'stream';
import type { TelegramPhoto } from './media';

export const MEDIA_STORAGE = Symbol('MediaStorage');

export interface MediaContent {
  body: Readable;
  /** En bytes, si el almacenamiento lo informa. */
  length?: number;
}

/** Dónde viven los bytes de las imágenes (Telegram, SPEC §4.3). */
export interface MediaStorage {
  upload(bytes: Buffer): Promise<TelegramPhoto>;

  open(fileId: string): Promise<MediaContent>;
}
