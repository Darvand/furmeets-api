import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';

/** Un aval: quién avala (lo ven todos los miembros, SPEC §3.3) y cuándo. */
@Schema({ _id: false })
export class RequestChatEndorsement {
  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name })
  from: User;

  @Prop({ default: Date.now })
  createdAt: Date;
}

export const RequestChatEndorsementSchema = SchemaFactory.createForClass(
  RequestChatEndorsement,
);
