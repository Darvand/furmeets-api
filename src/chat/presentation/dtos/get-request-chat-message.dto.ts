import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

export class GetRequestChatMessageDto {
  uuid: string;
  content: string;
  user: GetUserDto;
  /** Si quien pide la solicitud ya leyó el mensaje. */
  viewedByRequester: boolean;
  /** ISO-8601 UTC; el cliente lo formatea en su zona horaria. */
  sentAt: string;
}
