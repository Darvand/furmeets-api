import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { CreateRequestChatMessageDto } from "./dtos/create-request-chat-message.dto";
import { ChatService } from "../application/chat.service";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { RequestChatMessageMapper } from "../mappers/request-chat-message.mapper";
import type { Server } from "socket.io";
import { RequestChatEntity } from "../domain/entities/request-chat.entity";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { RequestChatMapper } from "../mappers/request-chat.mapper";
import { UseInterceptors } from "@nestjs/common";
import { TimingInterceptor } from "src/shared/interceptors/timing.interceptor";
import { InitDataAuthService } from "src/auth/application/init-data-auth.service";
import { type AuthenticatedSocket, wsAuthMiddleware } from "src/auth/presentation/ws-auth.middleware";

@WebSocketGateway({
    cors: {
        origin: process.env.FRONTEND_URL || '*',
        credentials: true,
    }
})
@UseInterceptors(TimingInterceptor)
export class ChatGateway implements OnGatewayInit {

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly chatService: ChatService,
        private readonly initDataAuth: InitDataAuthService,
    ) { }

    afterInit(server: Server): void {
        // Toda conexión se autentica con `handshake.auth.initData` antes de aceptarse.
        server.use(wsAuthMiddleware(this.initDataAuth));
    }

    @SubscribeMessage('request-chat')
    async handleChatRequest(
        @MessageBody() message: CreateRequestChatMessageDto,
        @ConnectedSocket() socket: AuthenticatedSocket,
    ): Promise<void> {
        // El autor es siempre el usuario del socket, nunca un campo del payload (RNF-SEG-02).
        const author = socket.data.user;
        const messageEntity = await this.chatService.addMessageToRequestChat(
            UUID.from(message.requestChatUUID),
            author,
            message.content
        )
        this.server.emit('request-chat', RequestChatMessageMapper.toDto(messageEntity, author));
    }

    async emitRequestChatUpdate(requestChat: RequestChatEntity, user: UserEntity): Promise<void> {
        this.server.emit('request-chat-update', RequestChatMapper.toDto(requestChat, user));
    }

    async emitNewRequestChat(requestChat: RequestChatEntity, viewer: UserEntity): Promise<void> {
        this.server.emit('new-request-chat', RequestChatMapper.toDto(requestChat, viewer));
    }
}
