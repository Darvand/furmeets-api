import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import type { MediaItem } from '../domain/media';
import type { MediaRepository } from '../domain/media.repository';
import { Media } from './media.schema';

type UUIDValue = Parameters<typeof toUUIDString>[0];
type MediaDoc = Omit<Media, '_id' | 'ownerId' | 'sharedWith'> & {
  _id: UUIDValue;
  ownerId?: UUIDValue;
  sharedWith?: UUIDValue[];
};

const MEDIA_PROJECTION = {
  kind: 1,
  fileId: 1,
  fileUniqueId: 1,
  ownerId: 1,
  sharedWith: 1,
  mimeType: 1,
};

@Injectable()
export class MediaMongoRepository implements MediaRepository {
  constructor(
    @InjectModel(Media.name) private readonly mediaModel: Model<Media>,
  ) {}

  async findById(id: string): Promise<MediaItem | null> {
    const doc = await this.mediaModel
      .findOne({ _id: id }, MEDIA_PROJECTION)
      .lean<MediaDoc>()
      .exec();
    return doc ? fromDb(doc) : null;
  }

  async findByIds(ids: readonly string[]): Promise<MediaItem[]> {
    const docs = await this.mediaModel
      .find({ _id: { $in: ids } }, MEDIA_PROJECTION)
      .lean<MediaDoc[]>()
      .exec();
    return docs.map(fromDb);
  }

  async create(media: MediaItem): Promise<void> {
    await this.mediaModel.create(toDb(media));
  }

  async shareWith(ids: readonly string[], userId: string): Promise<void> {
    await this.mediaModel
      .updateMany({ _id: { $in: ids } }, { $addToSet: { sharedWith: userId } })
      .exec();
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

function fromDb(doc: MediaDoc): MediaItem {
  return {
    id: toUUIDString(doc._id),
    kind: doc.kind,
    fileId: doc.fileId,
    fileUniqueId: doc.fileUniqueId,
    ownerId: doc.ownerId ? toUUIDString(doc.ownerId) : undefined,
    sharedWith: doc.sharedWith?.map(toUUIDString),
    mimeType: doc.mimeType,
  };
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
