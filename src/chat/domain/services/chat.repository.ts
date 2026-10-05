import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatEntity } from '../entities/request-chat.entity';
import type { Votes, VoteType } from 'src/review/domain/vote';
import type { Endorsement } from 'src/review/domain/endorsement';
import {
  RequestChatState,
  RequestChatStateType,
} from '../value-objects/request-chat-state.value-object';

/** Lo mínimo de una solicitud para enrutar al solicitante. */
export interface RequestChatSummary {
  id: UUID;
  state: RequestChatStateType;
}

/** El usuario ya tiene una solicitud (índice único de `requester`). */
export class DuplicateRequestChatError extends Error {
  constructor() {
    super('The requester already has a request chat');
    this.name = DuplicateRequestChatError.name;
  }
}

/** Lo mínimo de una solicitud para autorizar y validar un mensaje. */
export interface RequestChatHeader {
  id: UUID;
  requesterId: UUID;
  state: RequestChatStateType;
}

/** Posición en el listado: la última solicitud de la página anterior. */
export interface RequestChatCursor {
  createdAt: Date;
  id: UUID;
}

/**
 * Una solicitud tal como sale en el listado: resumen, sin mensajes. De los votos solo
 * hay conteos y el voto de quien mira (RNF-PRI-01).
 */
export interface RequestChatListItem {
  id: UUID;
  requester: UserEntity;
  state: RequestChatStateType;
  createdAt: Date;
  /** Falta si la solicitud no tiene mensajes (solicitudes antiguas sin migrar, T12). */
  lastMessage?: { author: UserEntity; content: string; at: Date };
  votes: { approved: number; rejected: number };
  viewerVote?: VoteType;
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
  /** Lanza `DuplicateRequestChatError` si el solicitante ya tiene una. */
  createRequestChat(requestChat: RequestChatEntity): Promise<void>;
  /**
   * Aplica el voto de un miembro con una sola operación atómica, si la solicitud sigue
   * en curso y no es suya: repetir el mismo voto lo retira y uno distinto reemplaza al
   * anterior. Devuelve los votos guardados (incluidos los de otros miembros que
   * votaron al mismo tiempo), o `null` si la solicitud no existe, ya no
   * está en curso o es de `voter`.
   */
  toggleVote(
    id: UUID,
    voter: UUID,
    type: VoteType,
    at: Date,
  ): Promise<Votes | null>;
  /**
   * Agrega el aval de `endorser` con una sola operación atómica, si la solicitud sigue en
   * curso y no es suya; si ya la avaló, no cambia nada. Devuelve los avales guardados con
   * quién avaló, o `null` si la solicitud no existe, ya no está en curso o es de
   * `endorser`.
   */
  endorse(id: UUID, endorser: UUID, at: Date): Promise<Endorsement[] | null>;
  /** Retira el aval de `endorser`; si no había avalado, no cambia nada. Igual que `endorse`. */
  withdrawEndorsement(id: UUID, endorser: UUID): Promise<Endorsement[] | null>;
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
