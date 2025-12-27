import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { CreateRequestChatMessageDto } from "./dtos/create-request-chat-message.dto";
import { ChatService } from "../application/chat.service";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { RequestChatMessageMapper } from "../mappers/request-chat-message.mapper";
import { Server } from "http";
import { UserService } from "src/members/application/user.service";
import { RequestChatEntity } from "../domain/entities/request-chat.entity";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { RequestChatMapper } from "../mappers/request-chat.mapper";

@WebSocketGateway({
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
    }
})
export class ChatGateway {

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly chatService: ChatService,
        private readonly userService: UserService,
    ) { }

    @SubscribeMessage('request-chat')
    async handleChatRequest(@MessageBody() message: CreateRequestChatMessageDto): Promise<void> {
        const messageEntity = await this.chatService.addMessageToRequestChat(
            UUID.from(message.requestChatUUID),
            UUID.from(message.userUUID),
            message.content
        )
        const user = await this.userService.getUserByUUID(UUID.from(message.userUUID));
        this.server.emit('request-chat', RequestChatMessageMapper.toDto(messageEntity, user));
    }

    async emitRequestChatUpdate(requestChat: RequestChatEntity, user: UserEntity): Promise<void> {
        this.server.emit('request-chat-update', RequestChatMapper.toDto(requestChat, user));
    }

    async emitNewRequestChat(requestChat: RequestChatEntity, viewer: UserEntity): Promise<void> {
        this.server.emit('new-request-chat', RequestChatMapper.toDto(requestChat, viewer));
    }
}
