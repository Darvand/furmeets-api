import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { MediaKinds, type MediaKind } from '../domain/media';

@Schema({ _id: false, collection: 'media' })
export class Media {
  @Prop({ type: mongoose.Schema.Types.UUID })
  _id: string;

  @Prop({ type: String, required: true, enum: Object.values(MediaKinds) })
  kind: MediaKind;

  @Prop({ required: true })
  fileId: string;

  @Prop({ required: true })
  fileUniqueId: string;

  @Prop({ type: mongoose.Schema.Types.UUID })
  ownerId?: string;

  @Prop({ required: true })
  mimeType: string;

  /**
   * `<kind>:<fileUniqueId>` en avatares y foto del grupo, para registrarlos una sola vez.
   * Las subidas no lo llevan: dos usuarios pueden subir la misma imagen.
   */
  @Prop({ unique: true, sparse: true })
  dedupeKey?: string;

  @Prop({ default: Date.now })
  createdAt?: Date;
}

export const MediaSchema = SchemaFactory.createForClass(Media);
