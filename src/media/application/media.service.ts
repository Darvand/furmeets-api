import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MembershipService } from 'src/membership/application/membership.service';
import { Roles } from 'src/membership/domain/role';
import type { UserEntity } from 'src/members/domain/entities/user.entity';
import { StorageNotConfiguredError } from 'src/telegram-bot/telegram-bot.service';
import { detectImageType } from '../domain/image-type';
import {
  MediaKinds,
  TELEGRAM_PHOTO_MIME_TYPE,
  visibleWithoutRole,
  type MediaItem,
  type MediaKind,
  type TelegramPhoto,
} from '../domain/media';
import {
  MEDIA_STORAGE,
  type MediaContent,
  type MediaStorage,
} from '../domain/media-storage.port';
import {
  MEDIA_REPOSITORY,
  type MediaRepository,
} from '../domain/media.repository';

export interface OpenedMedia extends MediaContent {
  mimeType: string;
}

/**
 * Imágenes guardadas en Telegram y servidas por `GET /media/:id` (SPEC §4.3). El cliente
 * solo conoce el id: ni el `file_id` ni la URL con el token del bot salen de la API.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(MEDIA_REPOSITORY) private readonly repository: MediaRepository,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    private readonly membershipService: MembershipService,
  ) {}

  /** Sube una imagen JPEG, PNG o WebP al canal de almacenamiento y devuelve su id. */
  async upload(owner: UserEntity, bytes: Buffer): Promise<string> {
    if (!detectImageType(bytes)) {
      throw new BadRequestException(
        'Only JPEG, PNG or WebP images are allowed',
      );
    }
    let photo: TelegramPhoto;
    try {
      photo = await this.storage.upload(bytes);
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        throw new ServiceUnavailableException(
          'Image uploads are not configured',
        );
      }
      throw error;
    }
    const id = randomUUID();
    await this.repository.create({
      id,
      kind: MediaKinds.Upload,
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      ownerId: owner.id.value,
      mimeType: TELEGRAM_PHOTO_MIME_TYPE,
    });
    return id;
  }

  /**
   * Las imágenes existen y las subió `owner` con `POST /media`: nadie adjunta a su
   * solicitud la imagen de otro, ni un avatar. Si no → 400.
   */
  async assertOwnUploads(
    owner: UserEntity,
    ids: readonly string[],
  ): Promise<void> {
    if (!ids.length) {
      return;
    }
    const own = (await this.repository.findByIds(ids)).filter(
      (media) =>
        media.kind === MediaKinds.Upload && media.ownerId === owner.id.value,
    );
    if (own.length !== new Set(ids).size) {
      throw new BadRequestException(
        'Images must be your own uploads from POST /media',
      );
    }
  }

  /**
   * `viewer` también ve esas imágenes, aunque no sea miembro: el solicitante de un chat
   * en el que un miembro las mandó. Llamar después de `assertOwnUploads`.
   */
  async shareUploads(ids: readonly string[], viewerId: string): Promise<void> {
    if (!ids.length) {
      return;
    }
    await this.repository.shareWith(ids, viewerId);
  }

  /** Registra una foto que ya está en Telegram (avatar, foto del grupo) y devuelve su id. */
  registerTelegramPhoto(
    kind: MediaKind,
    photo: TelegramPhoto,
    ownerId?: string,
  ): Promise<string> {
    return this.repository.registerOnce({
      id: randomUUID(),
      kind,
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      ownerId,
      mimeType: TELEGRAM_PHOTO_MIME_TYPE,
    });
  }

  /** Bytes de una imagen, si `viewer` puede verla (ver `visibleWithoutRole`). */
  async open(viewer: UserEntity, id: string): Promise<OpenedMedia> {
    const media = await this.repository.findById(id);
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    await this.assertCanView(viewer, media);
    const content = await this.storage.open(media.fileId);
    return { ...content, mimeType: media.mimeType };
  }

  private async assertCanView(
    viewer: UserEntity,
    media: MediaItem,
  ): Promise<void> {
    if (visibleWithoutRole(media, viewer.id.value)) {
      return;
    }
    if ((await this.membershipService.resolveRole(viewer)) !== Roles.Member) {
      throw new ForbiddenException('Not allowed to see this image');
    }
  }
}
