import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { type mongo } from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';

@Schema()
export class RequestChatVote {
  /** El votante. Nunca sale de la API: los votos son anónimos (SPEC §3.3). */
  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name })
  from: string | mongo.Binary;

  @Prop()
  type: string;

  @Prop({ default: Date.now })
  createdAt?: Date;

  @Prop({ default: Date.now })
  updatedAt?: Date;
}

export const RequestChatVoteSchema =
  SchemaFactory.createForClass(RequestChatVote);
