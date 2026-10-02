import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { CreateRequestChatMessageDto } from './dtos/create-request-chat-message.dto';
import { ChatService } from '../application/chat.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageMapper } from '../mappers/request-chat-message.mapper';
import type { Server } from 'socket.io';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatMapper } from '../mappers/request-chat.mapper';
import { Logger, UseInterceptors } from '@nestjs/common';
import { TimingInterceptor } from 'src/shared/interceptors/timing.interceptor';
import { InitDataAuthService } from 'src/auth/application/init-data-auth.service';
import {
  type AuthenticatedSocket,
  wsAuthMiddleware,
} from 'src/auth/presentation/ws-auth.middleware';
import { MembershipService } from 'src/membership/application/membership.service';
import { Roles } from 'src/membership/domain/role';
import { RequestChatAccessService } from '../application/request-chat-access.service';

/** Sala de todos los miembros: reciben los eventos de todas las solicitudes. */
export const MEMBERS_ROOM = 'members';
/** Sala de una solicitud: su solicitante (los miembros reciben por `members`). */
export const requestChatRoom = (requestChatId: string) =>
  `request-chat:${requestChatId.toLowerCase()}`;
/** Sala personal: todos los sockets de un usuario, para moverlos de sala de una vez. */
const userRoom = (telegramId: number) => `user:${telegramId}`;

/**
 * Chat en tiempo real con salas por rol (RNF-SEG-04, PRI-03): un miembro está en
 * `members`; un solicitante solo en la sala de su propia solicitud. Ningún evento se
 * emite a todos los sockets.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  },
})
@UseInterceptors(TimingInterceptor)
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly initDataAuth: InitDataAuthService,
    private readonly membershipService: MembershipService,
    private readonly access: RequestChatAccessService,
  ) {}

  afterInit(server: Server): void {
    // Toda conexión se autentica con `handshake.auth.initData` antes de aceptarse.
    server.use(wsAuthMiddleware(this.initDataAuth));
    // Si Telegram avisa que alguien entró o salió del grupo, se mueven sus sockets.
    this.membershipService.onInvalidate(
      (telegramId) => void this.syncMembersRoom(telegramId),
    );
  }

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    const user = socket.data.user;
    try {
      await socket.join(userRoom(user.telegramId));
      if ((await this.membershipService.resolveRole(user)) === Roles.Member) {
        await socket.join(MEMBERS_ROOM);
        return;
      }
      const own = await this.chatService.findRequestChatSummaryOf(user);
      if (own) {
        await socket.join(requestChatRoom(own.id.value));
      }
    } catch (error) {
      this.logger.error(
        'No se pudieron asignar las salas del socket',
        error as Error,
      );
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('request-chat')
  async handleChatRequest(
    @MessageBody() message: CreateRequestChatMessageDto,
    @ConnectedSocket() socket: AuthenticatedSocket,
  ): Promise<void> {
    // El autor es siempre el usuario del socket, nunca un campo del payload (RNF-SEG-02).
    const author = socket.data.user;
    if (!(await this.access.canAccess(author, message.requestChatUUID))) {
      this.logger.warn(
        'Autorización rechazada: request-chat (ni dueño ni miembro)',
      );
      throw new WsException('forbidden');
    }
    const messageEntity = await this.chatService.addMessageToRequestChat(
      UUID.from(message.requestChatUUID),
      author,
      message.content,
    );
    this.toRequestChat(message.requestChatUUID).emit(
      'request-chat',
      RequestChatMessageMapper.toDto(messageEntity, author),
    );
  }

  async emitRequestChatUpdate(
    requestChat: RequestChatEntity,
    user: UserEntity,
  ): Promise<void> {
    this.toRequestChat(requestChat.id.value).emit(
      'request-chat-update',
      RequestChatMapper.toDto(requestChat, user),
    );
  }

  async emitNewRequestChat(
    requestChat: RequestChatEntity,
    viewer: UserEntity,
  ): Promise<void> {
    // Los sockets ya abiertos del solicitante pasan a la sala de su nueva solicitud.
    this.server
      .in(userRoom(requestChat.props.requester.telegramId))
      .socketsJoin(requestChatRoom(requestChat.id.value));
    this.server
      .to(MEMBERS_ROOM)
      .emit('new-request-chat', RequestChatMapper.toDto(requestChat, viewer));
  }

  /** El solicitante de la solicitud y todos los miembros. */
  private toRequestChat(requestChatId: string) {
    return this.server.to(requestChatRoom(requestChatId)).to(MEMBERS_ROOM);
  }

  private async syncMembersRoom(telegramId: number): Promise<void> {
    try {
      const role = await this.membershipService.getRole(telegramId);
      const sockets = this.server.in(userRoom(telegramId));
      if (role === Roles.Member) {
        sockets.socketsJoin(MEMBERS_ROOM);
      } else {
        sockets.socketsLeave(MEMBERS_ROOM);
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo actualizar la sala de miembros: ${(error as Error).message}`,
      );
    }
  }
}
