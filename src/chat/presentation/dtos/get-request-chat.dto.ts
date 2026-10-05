import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';
import { GetRequestChatMessageDto } from './get-request-chat-message.dto';
import { GetApplicationFormDto } from 'src/applications/presentation/dtos/get-application-form.dto';

export class GetRequestChatDto {
  uuid: string;
  requester: GetUserDto;
  /** Los últimos mensajes (hasta 50), del más antiguo al más reciente. */
  messages: GetRequestChatMessageDto[];
  /**
   * Hay mensajes anteriores: se piden con `GET /request-chats/:id/messages?before=` y el
   * primero de `messages`.
   */
  hasOlderMessages: boolean;
  votes: {
    approved: number;
    rejected: number;
  };
  state: string;
  userVote?: string;
  /** Falta en las solicitudes anteriores al formulario actual: esas traen `legacy`. */
  form?: GetApplicationFormDto;
  /**
   * Solo en solicitudes anteriores al formulario actual: la App las muestra como
   * "Solicitud anterior al formulario actual" (T24).
   */
  legacy?: { howDidYouFindUs?: string; interests?: string };
}
