import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { CHAT_PROVIDERS } from "../chat.providers";
import { RequestChatEntity } from "../domain/entities/request-chat.entity";
import type { ChatRepository } from "../domain/services/chat.repository";
import { CreateRequestChatMessageDto } from "../presentation/dtos/create-request-chat-message.dto";
import { RequestChatMessageEntity } from "../domain/entities/request-chat-message.entity";
import { RequestChatMessageMapper } from "../mappers/request-chat-message.mapper";
import { UserService } from "src/members/application/user.service";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { CreateRequestChatDto } from "../presentation/dtos/create-request-chat.dto";

@Injectable()
export class ChatService {

    private readonly logger = new Logger(ChatService.name);

    constructor(
        @Inject(CHAT_PROVIDERS.RequestChatRepository) private readonly requestChatRepository: ChatRepository,
        private readonly userService: UserService,
    ) { }

    async createRequestChat(createRequestChatDto: CreateRequestChatDto): Promise<void> {
        this.logger.debug(`Creating request chat for requester UUID: ${createRequestChatDto.requesterUUID}`);
        const requester = await this.userService.getUserByUUID(UUID.from(createRequestChatDto.requesterUUID));
        const requestChat = RequestChatEntity.create({
            requester,
            messages: [],
            createdAt: new Date(),
        });
        await this.requestChatRepository.createRequestChat(requestChat);
    }

    async getRequestChatByUUID(id: UUID): Promise<RequestChatEntity> {
        const requestChat = await this.requestChatRepository.getRequestChatByUUID(id);
        if (!requestChat) {
            throw new NotFoundException(`RequestChat with ID ${id} not found`);
        }
        return requestChat;
    }

    async addMessageToRequestChat(requestChatUUID: UUID, userUUID: UUID, content: string): Promise<RequestChatMessageEntity> {
        this.logger.debug(`Adding message to request chat UUID: ${requestChatUUID} from user UUID: ${userUUID}`);
        const requestChat = await this.getRequestChatByUUID(requestChatUUID);
        const user = await this.userService.getUserByUUID(userUUID);
        const messageEntity = RequestChatMessageEntity.create({
            content,
            user,
        });
        requestChat.addMessage(messageEntity);
        await this.requestChatRepository.saveRequestChat(requestChat);
        return messageEntity;
    }

    async getAllRequestChats(): Promise<RequestChatEntity[]> {
        this.logger.debug(`Fetching all request chats`);
        return this.requestChatRepository.getAllRequestChats();
    }
}