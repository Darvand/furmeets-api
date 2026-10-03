import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  RequestChatEntity,
  type VoteTally,
  type VoteType,
} from '../entities/request-chat.entity';
import {
  RequestChatState,
  RequestChatStateType,
} from '../value-objects/request-chat-state.value-object';

/** Lo mínimo de una solicitud para enrutar al solicitante. */
export interface RequestChatSummary {
  id: UUID;
  state: RequestChatStateType;
}

/** Lo mínimo de una solicitud para autorizar y validar un mensaje. */
export interface RequestChatHeader {
  id: UUID;
  requesterId: UUID;
  state: RequestChatStateType;
}

/** Cómo quedan los votos tras el voto de un miembro. */
export interface VoteApplied {
  votes: VoteTally;
  /** El voto que le quedó al miembro; falta si lo retiró. */
  voterVote?: VoteType;
}

/** Posición en el listado: la última solicitud de la página anterior. */
export interface RequestChatCursor {
  createdAt: Date;
  id: UUID;
}

/**
 * Una solicitud tal como sale en el listado: resumen, sin mensajes ni votos.
 * De los votos solo hay conteos y el voto de quien mira (RNF-PRI-01).
 */
export interface RequestChatListItem {
  id: UUID;
  requester: UserEntity;
  state: RequestChatStateType;
  createdAt: Date;
  /** Falta si la solicitud no tiene mensajes (solicitudes antiguas sin migrar, T12). */
  lastMessage?: { author: UserEntity; content: string; at: Date };
  votes: { approved: number; rejected: number };
  viewerVote?: 'approve' | 'reject';
}

/** Una página del listado, de la más reciente a la más antigua. */
export interface RequestChatPage {
  items: RequestChatListItem[];
  /** Falta en la última página. */
  next?: RequestChatCursor;
}

/**
 * Ningún método reescribe la solicitud completa: cada cambio es una operación atómica
 * y filtrada (ADR-001, regla 2), así los cambios concurrentes no se pisan.
 */
export interface ChatRepository {
  createRequestChat(requestChat: RequestChatEntity): Promise<void>;
  /**
   * Aplica el voto de un miembro con una sola operación atómica, si la solicitud sigue
   * en curso: repetir el mismo voto lo retira y uno distinto reemplaza al anterior.
   * Devuelve los conteos con los votos guardados (incluidos los de otros miembros que
   * votaron al mismo tiempo), o `null` si la solicitud no existe o ya no está en curso.
   */
  toggleVote(
    id: UUID,
    voter: UUID,
    type: VoteType,
    at: Date,
  ): Promise<VoteApplied | null>;
  /** Cierra la solicitud si sigue en curso. Devuelve si esta llamada la cerró. */
  close(id: UUID, state: RequestChatState): Promise<boolean>;
  getRequestChatByUUID(id: UUID): Promise<RequestChatEntity | null>;
  chatAlreadyExistsForRequester(requesterUUID: UUID): Promise<boolean>;
  /** Id y estado de la solicitud del usuario, sin cargar mensajes ni votos. */
  findSummaryByRequester(
    requesterUUID: UUID,
  ): Promise<RequestChatSummary | null>;
  /** Solicitante y estado, sin cargar votos ni usuarios (una sola lectura). */
  findHeader(id: UUID): Promise<RequestChatHeader | null>;
  /**
   * Una página del listado con el resumen de cada solicitud, armado en la BD: no carga
   * mensajes, así el costo no depende de cuántos mensajes hay en total (RNF-REN-04).
   */
  listSummaries(
    viewer: UUID,
    page: { limit: number; after?: RequestChatCursor },
  ): Promise<RequestChatPage>;
}
