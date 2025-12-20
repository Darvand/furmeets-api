import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { RequestChatEntity } from "../entities/request-chat.entity";

export interface ChatRepository {
    saveRequestChat(requestChat: RequestChatEntity): Promise<void>;
    createRequestChat(requestChat: RequestChatEntity): Promise<void>;
    getRequestChatByUUID(id: UUID): Promise<RequestChatEntity | null>;
    getAllRequestChats(): Promise<RequestChatEntity[]>;
}