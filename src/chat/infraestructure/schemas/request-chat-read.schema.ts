import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';

export const REQUEST_CHAT_READS_COLLECTION = 'requestchatreads';

/**
 * Hasta dónde leyó un usuario el chat de una solicitud: todo mensaje posterior a
 * `lastReadAt` que no escribió él es un no leído. Un documento por usuario y solicitud,
 * que solo avanza (`$max`), así el listado cuenta no leídos sin revisar cada mensaje.
 */
@Schema({ collection: REQUEST_CHAT_READS_COLLECTION })
export class RequestChatRead {
  @Prop({ type: mongoose.Schema.Types.UUID, required: true })
  requestChatId: string;

  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name, required: true })
  userId: string;

  @Prop({ required: true })
  lastReadAt: Date;
}

export const RequestChatReadSchema =
  SchemaFactory.createForClass(RequestChatRead);

// Las lecturas de un usuario (listado) y la de un usuario en una solicitud (marcar leído).
RequestChatReadSchema.index({ userId: 1, requestChatId: 1 }, { unique: true });
