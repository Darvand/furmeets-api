import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

export class GetRequestChatMessageDto {
  uuid: string;
  content: string;
  user: GetUserDto;
  /** ISO-8601 UTC; el cliente lo formatea en su zona horaria. */
  sentAt: string;
}
