import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';
import { GetRequestChatMessageDto } from './get-request-chat-message.dto';
import { GetApplicationFormDto } from 'src/applications/presentation/dtos/get-application-form.dto';

export class GetRequestChatDto {
  uuid: string;
  requester: GetUserDto;
  messages: GetRequestChatMessageDto[];
  votes: {
    approved: number;
    rejected: number;
  };
  state: string;
  userVote?: string;
  /** Falta en las solicitudes anteriores al formulario (las migra T12). */
  form?: GetApplicationFormDto;
  whereYouFoundUs?: string;
  interests?: string;
}
