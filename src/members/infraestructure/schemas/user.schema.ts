import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class User {
  @Prop({
    type: mongoose.Schema.Types.UUID,
    default: () => mongoose.Types.UUID.generate(),
  })
  _id: string;

  @Prop()
  username?: string;

  /** Id en `media` (se sirve por `GET /media/:id`). */
  @Prop({ type: mongoose.Schema.Types.UUID })
  avatarMediaId?: string;

  @Prop()
  name: string;

  @Prop({ unique: true })
  telegramId: number;

  @Prop({
    default: false,
  })
  isMember: boolean;

  @Prop()
  birthdate?: Date;

  @Prop()
  species?: string;

  @Prop({ default: Date.now })
  createdAt?: Date;
}
export const UserSchema = SchemaFactory.createForClass(User);
