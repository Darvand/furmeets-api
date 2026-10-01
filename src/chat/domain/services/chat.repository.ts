import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { RequestChatEntity } from "../entities/request-chat.entity";
import { RequestChatStateType } from "../value-objects/request-chat-state.value-object";

/** Lo mínimo de una solicitud para enrutar al solicitante. */
export interface RequestChatSummary {
    id: UUID;
    state: RequestChatStateType;
}

export interface ChatRepository {
    saveRequestChat(requestChat: RequestChatEntity): Promise<void>;
    createRequestChat(requestChat: RequestChatEntity): Promise<void>;
    getRequestChatByUUID(id: UUID): Promise<RequestChatEntity | null>;
    chatAlreadyExistsForRequester(requesterUUID: UUID): Promise<boolean>;
    /** Id y estado de la solicitud del usuario, sin cargar mensajes ni votos. */
    findSummaryByRequester(requesterUUID: UUID): Promise<RequestChatSummary | null>;
    /** Solo el solicitante de una solicitud (para autorizar), sin cargar el resto. */
    findRequesterId(id: UUID): Promise<UUID | null>;
    getAllRequestChats(): Promise<RequestChatEntity[]>;
}