import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  RequestChatEntity,
  type VoteChange,
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

/**
 * Ningún método reescribe la solicitud completa: cada cambio es una operación atómica
 * y filtrada (ADR-001, regla 2), así los cambios concurrentes no se pisan.
 */
export interface ChatRepository {
  createRequestChat(requestChat: RequestChatEntity): Promise<void>;
  /**
   * Guarda el voto de un miembro si la solicitud sigue en curso. Devuelve la solicitud
   * con los votos guardados (incluidos los de otros miembros), o `null` si ya no está
   * en curso.
   */
  applyVote(
    id: UUID,
    change: VoteChange,
    at: Date,
  ): Promise<RequestChatEntity | null>;
  /** Cierra la solicitud si sigue en curso. Devuelve si esta llamada la cerró. */
  close(id: UUID, state: RequestChatState): Promise<boolean>;
  getRequestChatByUUID(id: UUID): Promise<RequestChatEntity | null>;
  chatAlreadyExistsForRequester(requesterUUID: UUID): Promise<boolean>;
  /** Id y estado de la solicitud del usuario, sin cargar mensajes ni votos. */
  findSummaryByRequester(
    requesterUUID: UUID,
  ): Promise<RequestChatSummary | null>;
  /** Solo el solicitante de una solicitud (para autorizar), sin cargar el resto. */
  findRequesterId(id: UUID): Promise<UUID | null>;
  getAllRequestChats(): Promise<RequestChatEntity[]>;
}
