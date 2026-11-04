import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { HydratedDocument } from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import {
  RequestChatVote,
  RequestChatVoteSchema,
} from './request-chat-vote.schema';
import {
  RequestChatEndorsement,
  RequestChatEndorsementSchema,
} from './request-chat-endorsement.schema';
import {
  ApplicationFormDoc,
  ApplicationFormSchema,
} from 'src/applications/infraestructure/application-form.schema';
import {
  LegacyApplicationDoc,
  LegacyApplicationSchema,
} from 'src/applications/infraestructure/legacy-application.schema';

export type RequestChatDocument = HydratedDocument<RequestChat>;

@Schema({ _id: false })
export class RequestChat {
  @Prop({
    type: mongoose.Schema.Types.UUID,
    default: () => mongoose.Types.UUID.generate(),
  })
  _id: string;

  /** Único: una solicitud por usuario, sin importar su estado (SPEC §3.1). */
  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name, unique: true })
  requester: User;

  /** Falta en las solicitudes anteriores al formulario actual: esas llevan `legacy`. */
  @Prop({ type: ApplicationFormSchema })
  form?: ApplicationFormDoc;

  /** Solicitud anterior al formulario actual (`legacy: true`). La crea la migración de T12. */
  @Prop({ type: LegacyApplicationSchema })
  legacy?: LegacyApplicationDoc;

  @Prop({ type: [RequestChatVoteSchema] })
  votes: RequestChatVote[];

  /** Falta en las solicitudes anteriores a T22: equivale a ninguno. */
  @Prop({ type: [RequestChatEndorsementSchema], default: undefined })
  endorsements?: RequestChatEndorsement[];

  @Prop()
  state: string;

  @Prop({ default: Date.now })
  updatedAt?: Date;

  @Prop({ default: Date.now })
  createdAt?: Date;
}

export const RequestChatSchema = SchemaFactory.createForClass(RequestChat);

// El listado: de la más reciente a la más antigua, paginado por `createdAt` + `_id`.
RequestChatSchema.index({ createdAt: -1, _id: -1 });
