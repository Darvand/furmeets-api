import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import type { MediaItem } from '../domain/media';
import type { MediaRepository } from '../domain/media.repository';
import { Media } from './media.schema';

type UUIDValue = Parameters<typeof toUUIDString>[0];
type MediaDoc = Omit<Media, '_id' | 'ownerId'> & {
  _id: UUIDValue;
  ownerId?: UUIDValue;
};

@Injectable()
export class MediaMongoRepository implements MediaRepository {
  constructor(
    @InjectModel(Media.name) private readonly mediaModel: Model<Media>,
  ) {}

  async findById(id: string): Promise<MediaItem | null> {
    const doc = await this.mediaModel
      .findOne(
        { _id: id },
        { kind: 1, fileId: 1, fileUniqueId: 1, ownerId: 1, mimeType: 1 },
      )
      .lean<MediaDoc>()
      .exec();
    if (!doc) {
      return null;
    }
    return {
      id: toUUIDString(doc._id),
      kind: doc.kind,
      fileId: doc.fileId,
      fileUniqueId: doc.fileUniqueId,
      ownerId: doc.ownerId ? toUUIDString(doc.ownerId) : undefined,
      mimeType: doc.mimeType,
    };
  }

  async create(media: MediaItem): Promise<void> {
    await this.mediaModel.create(toDb(media));
  }

  async registerOnce(media: MediaItem): Promise<string> {
    const dedupeKey = `${media.kind}:${media.fileUniqueId}`;
    const upsert = () =>
      // Solo `$setOnInsert`: si ya existe, Mongo no escribe nada.
      this.mediaModel
        .findOneAndUpdate(
          { dedupeKey },
          {
            $setOnInsert: { ...toDb(media), dedupeKey, createdAt: new Date() },
          },
          {
            upsert: true,
            new: true,
            projection: { _id: 1 },
            setDefaultsOnInsert: false,
          },
        )
        .lean<{ _id: UUIDValue }>()
        .exec();
    let doc: { _id: UUIDValue } | null;
    try {
      doc = await upsert();
    } catch (error) {
      // Dos registros simultáneos del mismo archivo: el índice único deja pasar uno y
      // el reintento encuentra ese.
      if ((error as { code?: unknown } | null)?.code !== 11000) {
        throw error;
      }
      doc = await upsert();
    }
    return toUUIDString(doc._id);
  }
}

function toDb(media: MediaItem): Media {
  return {
    _id: media.id,
    kind: media.kind,
    fileId: media.fileId,
    fileUniqueId: media.fileUniqueId,
    ownerId: media.ownerId,
    mimeType: media.mimeType,
  };
}
