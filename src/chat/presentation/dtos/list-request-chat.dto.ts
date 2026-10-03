import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

/** Holgado mientras la App pide solo la primera página (la paginación llega con T23). */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

/** `GET /request-chats?limit=&cursor=` */
export class ListRequestChatQueryDto {
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
  /** Mensajes que quien mira no leyó; como máximo 100, que significa "100 o más". */
  unreadMessagesCount: number;
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
}
