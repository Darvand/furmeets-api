import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { RequestChatScope } from 'src/chat/domain/services/chat.repository';
import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

/** Holgado mientras la App pide solo la primera página (la paginación llega con T23). */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

const REQUEST_CHAT_SCOPES: RequestChatScope[] = ['open', 'closed'];

/** `GET /request-chats?scope=&limit=&cursor=` */
export class ListRequestChatQueryDto {
  /** `open`: en curso; `closed`: el historial. Sin él, todas. */
  @IsOptional()
  @IsIn(REQUEST_CHAT_SCOPES)
  scope?: RequestChatScope;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit?: number;

  /** `nextCursor` de la página anterior. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

class RequestChatItemDto {
  uuid: string;
  requester: GetUserDto;
  /** Falta si la solicitud no tiene mensajes (solicitudes antiguas sin migrar, T12). */
  lastMessage?: {
    from: GetUserDto;
    content: string;
    /** ISO-8601 UTC. */
    at: string;
  };
  state: string;
  /** Solo conteos: nunca quién votó (RNF-PRI-01). */
  votes: {
    approved: number;
    rejected: number;
  };
  /** El voto de quien pide el listado, si votó. */
  userVote?: string;
  /** ISO-8601 UTC. */
  createdAt: string;
}

export class ListRequestChatDto {
  /** De la más reciente a la más antigua. */
  items: RequestChatItemDto[];
  /** Para pedir la página siguiente; falta en la última. */
  nextCursor?: string;
  /** De toda la BD: no dependen de la página ni de `scope`. */
  totals: {
    total: number;
    inProgress: number;
    approved: number;
    rejected: number;
  };
  /** Los umbrales vigentes, para mostrar "4/5 a favor". */
  thresholds: {
    approve: number;
    reject: number;
  };
}
