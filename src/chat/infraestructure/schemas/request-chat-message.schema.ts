import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { User } from 'src/members/infraestructure/schemas/user.schema';

/** Quién leyó un mensaje y cuándo (SPEC §9.1: `viewedBy` → `readBy`). */
@Schema({ _id: false })
export class MessageRead {
  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name, required: true })
  userId: string;

  @Prop({ required: true })
  at: Date;
}

export const MessageReadSchema = SchemaFactory.createForClass(MessageRead);

/**
 * Mensaje del chat de una solicitud, en su propia colección (`requestchatmessages`).
 * Se inserta una vez y no se reescribe: `createdAt` lo fija el servidor al enviarlo
 * (sin `timestamps` de Mongoose, que lo reiniciaban al guardar; deuda #5).
 */
@Schema({ _id: false, collection: 'requestchatmessages' })
export class RequestChatMessage {
  @Prop({ type: mongoose.Schema.Types.UUID, required: true })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.UUID, required: true })
  requestChatId: string;

  @Prop({ type: mongoose.Schema.Types.UUID, ref: User.name, required: true })
  authorId: string;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [MessageReadSchema], default: [] })
  readBy: MessageRead[];

  @Prop({ required: true })
  createdAt: Date;
}

export const RequestChatMessageSchema =
  SchemaFactory.createForClass(RequestChatMessage);

// El historial de una solicitud, en orden (y el último mensaje para el listado).
RequestChatMessageSchema.index({ requestChatId: 1, createdAt: 1 });
