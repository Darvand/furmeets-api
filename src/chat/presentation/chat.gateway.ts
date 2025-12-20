import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { CreateRequestChatMessageDto } from "./dtos/create-request-chat-message.dto";
import { ChatService } from "../application/chat.service";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { RequestChatMessageMapper } from "../mappers/request-chat-message.mapper";
import { Server } from "http";

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
    ) { }

    @SubscribeMessage('request-chat')
    async handleChatRequest(@MessageBody() message: CreateRequestChatMessageDto): Promise<void> {
        const messageEntity = await this.chatService.addMessageToRequestChat(
            UUID.from(message.requestChatUUID),
            UUID.from(message.userUUID),
            message.content
        )
        this.server.emit('request-chat', RequestChatMessageMapper.toDto(messageEntity));
    }
}
