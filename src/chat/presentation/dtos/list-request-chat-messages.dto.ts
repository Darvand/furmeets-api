import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { GetRequestChatMessageDto } from './get-request-chat-message.dto';

export const DEFAULT_MESSAGES_LIMIT = 50;
export const MAX_MESSAGES_LIMIT = 100;

/** `GET /request-chats/:id/messages?after=&limit=` */
export class ListMessagesAfterQueryDto {
  /** Último mensaje que tiene el cliente: se devuelven los posteriores. */
  @IsUUID()
  after: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGES_LIMIT)
  limit?: number;
}

export class ListMessagesAfterDto {
  /** Del más antiguo al más reciente. */
  items: GetRequestChatMessageDto[];
  /** Quedan más: pedir de nuevo con `after` = el último de `items`. */
  hasMore: boolean;
}
