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
import {
  ChatService,
  type RequestChatView,
  type VoteResult,
} from '../application/chat.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageMapper } from '../mappers/request-chat-message.mapper';
import type { Server } from 'socket.io';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatMapper } from '../mappers/request-chat.mapper';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { createWsValidationPipe } from 'src/shared/validation/validation';
import { TimingInterceptor } from 'src/shared/interceptors/timing.interceptor';
import { InitDataAuthService } from 'src/auth/application/init-data-auth.service';
import {
  type AuthenticatedSocket,
  wsAuthMiddleware,
} from 'src/auth/presentation/ws-auth.middleware';
import { MembershipService } from 'src/membership/application/membership.service';
import { Roles } from 'src/membership/domain/role';
import { isUUID } from 'class-validator';
import type { InsertedMessage } from '../domain/services/request-chat-message.repository';
import { GetRequestChatMessageDto } from './dtos/get-request-chat-message.dto';

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
  @UsePipes(createWsValidationPipe())
  async handleChatRequest(
    @MessageBody() message: CreateRequestChatMessageDto,
    @ConnectedSocket() socket: AuthenticatedSocket,
  ): Promise<GetRequestChatMessageDto> {
    // El autor es siempre el usuario del socket, nunca un campo del payload (RNF-SEG-02).
    const author = socket.data.user;
    if (!isUUID(message.requestChatUUID)) {
      throw this.forbidden();
    }
    let inserted: InsertedMessage;
    try {
      // Guarda y vuelve: el aviso de Telegram queda en segundo plano (RNF-REN-08).
      inserted = await this.chatService.addMessageToRequestChat(
        UUID.from(message.requestChatUUID),
        author,
        {
          content: message.content,
          imageIds: message.imageIds,
          replyToId: message.replyToId
            ? UUID.from(message.replyToId)
            : undefined,
        },
        message.clientMessageId,
      );
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw this.forbidden();
      }
      // Igual que un payload mal formado: la App lo marca como no enviado.
      if (error instanceof BadRequestException) {
        throw new WsException('invalid-payload');
      }
      throw error;
    }
    const dto = RequestChatMessageMapper.toDto(inserted.message);
    // Un reenvío (mismo `clientMessageId`) ya se emitió la primera vez.
    if (inserted.created) {
      this.toRequestChat(message.requestChatUUID).emit('request-chat', dto);
    }
    // Ack al emisor: el mensaje ya quedó guardado.
    return dto;
  }

  private forbidden(): WsException {
    this.logger.warn(
      'Autorización rechazada: request-chat (ni dueño ni miembro)',
    );
    return new WsException('forbidden');
  }

  /** La solicitud cambió de estado. Sin `userVote`: lo reciben todos. */
  emitRequestChatUpdate({ requestChat, messages }: RequestChatView): void {
    this.toRequestChat(requestChat.id.value).emit(
      'request-chat-update',
      RequestChatMapper.toDto(requestChat, messages),
    );
  }

  /** Conteos tras un voto, solo a los miembros: el solicitante no vota. */
  emitVotes(result: VoteResult): void {
    this.server
      .to(MEMBERS_ROOM)
      .emit('request-chat-votes', RequestChatMapper.toVotesEvent(result));
  }

  emitNewRequestChat(
    { requestChat, messages }: RequestChatView,
    viewer: UserEntity,
  ): void {
    // Los sockets ya abiertos del solicitante pasan a la sala de su nueva solicitud.
    this.server
      .in(userRoom(requestChat.props.requester.telegramId))
      .socketsJoin(requestChatRoom(requestChat.id.value));
    this.server
      .to(MEMBERS_ROOM)
      .emit(
        'new-request-chat',
        RequestChatMapper.toDto(requestChat, messages, viewer),
      );
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
