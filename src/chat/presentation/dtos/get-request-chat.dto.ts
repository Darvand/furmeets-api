import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';
import { GetRequestChatMessageDto } from './get-request-chat-message.dto';
import { GetApplicationFormDto } from 'src/applications/presentation/dtos/get-application-form.dto';
import type { VoteType } from 'src/review/domain/vote';
import type { RequestChatVotingDto } from './vote-request-chat.dto';

/**
 * Una solicitud tal como la ve su solicitante mientras no sea miembro: sin votos
 * (RNF-PRI-03). Los miembros reciben además la votación (`MemberRequestChatDto`).
 */
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
  state: string;
  /** Falta en las solicitudes anteriores al formulario actual: esas traen `legacy`. */
  form?: GetApplicationFormDto;
  /**
   * Solo en solicitudes anteriores al formulario actual: la App las muestra como
   * "Solicitud anterior al formulario actual" (T24).
   */
  legacy?: { howDidYouFindUs?: string; interests?: string };
}

/** Una solicitud tal como la ve un miembro: con la votación y su propio voto. */
export type MemberRequestChatDto = GetRequestChatDto &
  RequestChatVotingDto & {
    /** El voto de quien pide la solicitud; falta si no votó o en eventos para todos. */
    userVote?: VoteType;
  };
