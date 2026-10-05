import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';

export const REQUEST_CHAT_MESSAGES_COLLECTION = 'requestchatmessages';

/**
 * Mensaje del chat de una solicitud, en su propia colección (`requestchatmessages`).
 * Se inserta una vez y no se reescribe: `createdAt` lo fija el servidor al enviarlo
 * (sin `timestamps` de Mongoose, que lo reiniciaban al guardar; deuda #5).
 */
@Schema({ _id: false, collection: REQUEST_CHAT_MESSAGES_COLLECTION })
export class RequestChatMessage {
  @Prop({ type: mongoose.Schema.Types.UUID, required: true })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.UUID, required: true })
  requestChatId: string;

  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name, required: true })
  authorId: string;

  /**
   * Solo en los mensajes de sistema (`'system'`); falta en los de usuario. Los del bot
   * anteriores a T19 los marca la migración 002.
   */
  @Prop({ type: String, enum: ['system'] })
  type?: 'system';

  /** Vacío si el mensaje es solo imágenes. */
  @Prop({ default: '' })
  content: string;

  /** Ids de `media`; falta si no tiene imágenes. */
  @Prop({ type: [mongoose.Schema.Types.UUID], default: undefined })
  imageIds?: string[];

  @Prop({ required: true })
  createdAt: Date;

  /** Id del envío generado por el cliente (texto: no referencia a otro documento). */
  @Prop()
  clientMessageId?: string;
}

export const RequestChatMessageSchema =
  SchemaFactory.createForClass(RequestChatMessage);

// El historial de una solicitud, en orden y paginado en los dos sentidos (y el último
// mensaje para el listado). `_id` desempata los `createdAt` repetidos de los mensajes
// migrados (T12). Reemplaza a `requestChatId_1_createdAt_1` (T18).
RequestChatMessageSchema.index({ requestChatId: 1, createdAt: 1, _id: 1 });

// Idempotencia (T16): un envío por autor y `clientMessageId` en cada solicitud. Los
// mensajes sin id (bot, sistema, anteriores a T16) quedan fuera del índice.
RequestChatMessageSchema.index(
  { requestChatId: 1, authorId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $exists: true } },
  },
);
