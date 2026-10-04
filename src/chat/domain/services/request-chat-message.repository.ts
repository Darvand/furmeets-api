import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageEntity } from '../entities/request-chat-message.entity';

/** Resultado de un envío: el mensaje guardado y si este envío lo creó. */
export interface InsertedMessage {
  message: RequestChatMessageEntity;
  /** `false` si era un reenvío del mismo `clientMessageId`: no se vuelve a emitir. */
  created: boolean;
}

/** Una página de mensajes posteriores a otro (recuperación al reconectar). */
export interface MessagesAfter {
  items: RequestChatMessageEntity[];
  hasMore: boolean;
}

export interface RequestChatMessageRepository {
  /** Un mensaje nuevo es una sola inserción: los envíos concurrentes no se pisan. */
  insert(message: RequestChatMessageEntity): Promise<void>;
  /**
   * Inserta un mensaje de usuario una sola vez por autor y `clientMessageId` en su
   * solicitud: un reenvío, aunque llegue a la vez, devuelve el mensaje ya guardado.
   */
  insertOnce(message: RequestChatMessageEntity): Promise<InsertedMessage>;
  /** Mensajes de una solicitud, del más antiguo al más reciente. */
  findByRequestChat(requestChatId: UUID): Promise<RequestChatMessageEntity[]>;
  /**
   * Hasta `limit` mensajes posteriores a `afterId`, en orden. `null` si `afterId` no es
   * un mensaje de esa solicitud.
   */
  findAfter(
    requestChatId: UUID,
    afterId: UUID,
    limit: number,
  ): Promise<MessagesAfter | null>;
}
