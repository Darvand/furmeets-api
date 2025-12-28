import { forwardRef, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { CHAT_PROVIDERS } from "../chat.providers";
import { RequestChatEntity } from "../domain/entities/request-chat.entity";
import type { ChatRepository } from "../domain/services/chat.repository";
import { RequestChatMessageEntity } from "../domain/entities/request-chat-message.entity";
import { UserService } from "src/members/application/user.service";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { CreateRequestChatDto } from "../presentation/dtos/create-request-chat.dto";
import { DateTime } from "luxon";
import { RequestChatState } from "../domain/value-objects/request-chat-state.value-object";
import { ChatMessageViewedByEntity } from "../domain/entities/chat-message-viewed-by.entity";
import { ChatDate } from "../domain/value-objects/chat-date.value-object";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";
import { RequestChatVoteEntity } from "../domain/entities/request-chat-vote.entity";
import { ChatGateway } from "../presentation/chat.gateway";

@Injectable()
export class ChatService {

    private readonly logger = new Logger(ChatService.name);

    constructor(
        @Inject(CHAT_PROVIDERS.RequestChatRepository) private readonly requestChatRepository: ChatRepository,
        private readonly userService: UserService,
        private readonly telegramBotService: TelegramBotService,
        @Inject(forwardRef(() => ChatGateway)) private readonly chatGateway: ChatGateway,
    ) { }

    async createRequestChat(createRequestChatDto: CreateRequestChatDto): Promise<RequestChatEntity> {
        this.logger.debug(`Creating request chat for requester UUID: ${createRequestChatDto.requesterUUID}`);
        const requester = await this.userService.getUserByUUID(UUID.from(createRequestChatDto.requesterUUID));
        const requestChat = RequestChatEntity.create({
            requester,
            messages: [],
            createdAt: DateTime.now(),
            state: RequestChatState.InProgress(),
            votes: [],
            interests: createRequestChatDto.interests,
            whereYouFoundUs: createRequestChatDto.whereYouFoundUs,
        });
        const bot = await this.userService.getBotUser();
        requestChat.addWelcomeMessage(bot);
        await this.requestChatRepository.createRequestChat(requestChat);
        await this.telegramBotService.sendMessageToGroup(requestChat.announceWelcomeMesssage());
        await this.chatGateway.emitNewRequestChat(requestChat, requester);
        return requestChat;
    }

    async getRequestChatByUUID(id: UUID, viewer: UserEntity): Promise<RequestChatEntity> {
        const requestChat = await this.requestChatRepository.getRequestChatByUUID(id);
        if (!requestChat) {
            throw new NotFoundException(`RequestChat with ID ${id} not found`);
        }
        requestChat.markLastMessageViewedBy(viewer);
        await this.requestChatRepository.saveRequestChat(requestChat);
        return requestChat;
    }

    async addMessageToRequestChat(requestChatUUID: UUID, userUUID: UUID, content: string): Promise<RequestChatMessageEntity> {
        this.logger.debug(`Adding message to request chat UUID: ${requestChatUUID} from user UUID: ${userUUID}`);
        const user = await this.userService.getUserByUUID(userUUID);
        const requestChat = await this.getRequestChatByUUID(requestChatUUID, user);
        const messageEntity = RequestChatMessageEntity.create({
            content,
            user,
            viewedBy: [ChatMessageViewedByEntity.create({ by: user, at: ChatDate.now() })],
            createdAt: ChatDate.now(),
        });
        requestChat.addMessage(messageEntity);
        await this.requestChatRepository.saveRequestChat(requestChat);
        if (messageEntity.fromUser(requestChat.props.requester)) {
            await this.telegramBotService.sendMessageToGroup(`Nuevo mensaje de ${requestChat.props.requester.name} en el chat de solicitud`);
        }
        return messageEntity;
    }

    async getAllRequestChats(): Promise<RequestChatEntity[]> {
        this.logger.debug(`Fetching all request chats`);
        return this.requestChatRepository.getAllRequestChats();
    }

    async voteOnRequestChat(requestChatUUID: UUID, userUUID: UUID, type: 'approve' | 'reject'): Promise<RequestChatEntity> {
        this.logger.debug(`User UUID: ${userUUID} voting on request chat UUID: ${requestChatUUID} with type: ${type}`);
        const user = await this.userService.getUserByUUID(userUUID);
        const requestChat = await this.getRequestChatByUUID(requestChatUUID, user);
        const voteEntity = RequestChatVoteEntity.create({
            createdAt: DateTime.now(),
            user,
            type,
        });
        requestChat.addVote(voteEntity);
        if (requestChat.isApproved()) {
            await this.chatGateway.emitRequestChatUpdate(requestChat, user);
            requestChat.addApprovedMessage(await this.userService.getBotUser());
            await this.telegramBotService.sendMessageToGroup(requestChat.announceApproval());
            await this.telegramBotService.sendInviteLinkToUser(requestChat.props.requester.telegramId);
        }
        if (requestChat.isRejected()) {
            await this.telegramBotService.sendMessageToGroup(requestChat.announceRejection());
            await this.chatGateway.emitRequestChatUpdate(requestChat, user);
            requestChat.addRejectedMessage(await this.userService.getBotUser());
        }
        await this.requestChatRepository.saveRequestChat(requestChat);
        return requestChat;
    }
}