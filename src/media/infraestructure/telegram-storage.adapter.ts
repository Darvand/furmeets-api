import { BadGatewayException, Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import type { ReadableStream } from 'stream/web';
import { TtlCache } from 'src/shared/cache/ttl-cache';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import type { TelegramPhoto } from '../domain/media';
import type { MediaContent, MediaStorage } from '../domain/media-storage.port';

/** Telegram garantiza el `file_path` al menos 1 h; se cachea bastante menos (SPEC §4.3). */
export const FILE_PATH_TTL_MS = 30 * 60 * 1000;
const FILE_PATH_CACHE_MAX_ENTRIES = 1_000;

/**
 * Imágenes en Telegram: se suben al canal de almacenamiento y se descargan resolviendo
 * `getFile`. Si el `file_path` cacheado ya no sirve, se pide uno nuevo una vez.
 */
@Injectable()
export class TelegramStorageAdapter implements MediaStorage {
  private readonly filePaths = new TtlCache<string, string>({
    ttlMs: FILE_PATH_TTL_MS,
    maxEntries: FILE_PATH_CACHE_MAX_ENTRIES,
  });

  constructor(private readonly telegram: TelegramBotService) {}

  upload(bytes: Buffer): Promise<TelegramPhoto> {
    return this.telegram.uploadPhotoToStorage(bytes);
  }

  async open(fileId: string): Promise<MediaContent> {
    let response = await this.download(fileId);
    if (response.status === 400 || response.status === 404) {
      // El `file_path` venció antes de lo esperado.
      await response.body?.cancel();
      this.filePaths.delete(fileId);
      response = await this.download(fileId);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new BadGatewayException('Could not fetch the image from Telegram');
    }
    const length = Number(response.headers.get('content-length'));
    return {
      body: Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      length: length > 0 ? length : undefined,
    };
  }

  private async download(fileId: string): Promise<Response> {
    const filePath = await this.filePaths.getOrLoad(fileId, () =>
      this.telegram.getFilePath(fileId),
    );
    return this.telegram.downloadFile(filePath);
  }
}
