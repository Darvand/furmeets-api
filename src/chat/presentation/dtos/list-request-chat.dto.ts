import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

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
  unreadMessagesCount: number;
  state: string;
}

export class ListRequestChatDto {
  items: RequestChatItemDto[];
}
