import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageEntity } from '../entities/request-chat-message.entity';

/** Resultado de un envío: el mensaje guardado y si este envío lo creó. */
export interface InsertedMessage {
  message: RequestChatMessageEntity;
  /** `false` si era un reenvío del mismo `clientMessageId`: no se vuelve a emitir. */
  created: boolean;
}

/** Una página de mensajes, siempre del más antiguo al más reciente. */
export interface MessagesPage {
  items: RequestChatMessageEntity[];
  /** Quedan más en la dirección pedida: anteriores (`findLatest`, `findBefore`) o posteriores (`findAfter`). */
  hasMore: boolean;
}

/**
 * Los mensajes se ordenan por `createdAt` y, si empatan (mensajes migrados sin fecha
 * propia, T12), por `_id`: las páginas no repiten ni saltan mensajes.
 */
export interface RequestChatMessageRepository {
  /** Un mensaje nuevo es una sola inserción: los envíos concurrentes no se pisan. */
  insert(message: RequestChatMessageEntity): Promise<void>;
  /**
   * Inserta un mensaje de usuario una sola vez por autor y `clientMessageId` en su
   * solicitud: un reenvío, aunque llegue a la vez, devuelve el mensaje ya guardado.
   */
  insertOnce(message: RequestChatMessageEntity): Promise<InsertedMessage>;
  /** Los últimos `limit` mensajes de una solicitud (al abrir el chat). */
  findLatest(requestChatId: UUID, limit: number): Promise<MessagesPage>;
  /**
   * Hasta `limit` mensajes anteriores a `beforeId` (historial). `null` si `beforeId` no
   * es un mensaje de esa solicitud.
   */
  findBefore(
    requestChatId: UUID,
    beforeId: UUID,
    limit: number,
  ): Promise<MessagesPage | null>;
  /**
   * Hasta `limit` mensajes posteriores a `afterId` (recuperación al reconectar). `null`
   * si `afterId` no es un mensaje de esa solicitud.
   */
  findAfter(
    requestChatId: UUID,
    afterId: UUID,
    limit: number,
  ): Promise<MessagesPage | null>;
}
