import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { GetRequestChatMessageDto } from './get-request-chat-message.dto';

export const DEFAULT_MESSAGES_LIMIT = 50;
export const MAX_MESSAGES_LIMIT = 100;

/**
 * `GET /request-chats/:id/messages?before=&limit=` (historial, T18) o `?after=&limit=`
 * (recuperación al reconectar, T16). Lleva uno de los dos, no ambos (lo revisa el
 * controlador).
 */
export class ListMessagesQueryDto {
  /** Primer mensaje que tiene el cliente: se devuelven los anteriores. */
  @IsOptional()
  @IsUUID()
  before?: string;

  /** Último mensaje que tiene el cliente: se devuelven los posteriores. */
  @IsOptional()
  @IsUUID()
  after?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGES_LIMIT)
  limit?: number;
}

export class ListMessagesDto {
  /** Del más antiguo al más reciente. */
  items: GetRequestChatMessageDto[];
  /**
   * Quedan más en la dirección pedida: con `before`, pedir de nuevo con el primero de
   * `items`; con `after`, con el último.
   */
  hasMore: boolean;
}
