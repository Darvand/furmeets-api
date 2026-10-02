import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CHAT_PROVIDERS } from '../chat.providers';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import type {
  ChatRepository,
  RequestChatSummary,
} from '../domain/services/chat.repository';
import type { RequestChatMessageRepository } from '../domain/services/request-chat-message.repository';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { UserService } from 'src/members/application/user.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { CreateRequestChatDto } from '../presentation/dtos/create-request-chat.dto';
import { DateTime } from 'luxon';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { RequestChatVoteEntity } from '../domain/entities/request-chat-vote.entity';
import { ChatGateway } from '../presentation/chat.gateway';
import { MonotonicClock } from 'src/shared/time/monotonic-clock';

/** Una solicitud con sus mensajes, en orden cronológico. */
export interface RequestChatView {
  requestChat: RequestChatEntity;
  messages: RequestChatMessageEntity[];
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  /** Fecha de cada mensaje: única y creciente, para que el orden sea el de llegada. */
  private readonly clock = new MonotonicClock();

  constructor(
    @Inject(CHAT_PROVIDERS.RequestChatRepository)
    private readonly requestChatRepository: ChatRepository,
    @Inject(CHAT_PROVIDERS.RequestChatMessageRepository)
    private readonly messageRepository: RequestChatMessageRepository,
    private readonly userService: UserService,
    private readonly telegramBotService: TelegramBotService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  async createRequestChat(
    createRequestChatDto: CreateRequestChatDto,
  ): Promise<RequestChatView> {
    this.logger.debug(
      `Creating request chat for requester UUID: ${createRequestChatDto.requesterUUID}`,
    );
    const requester = await this.userService.getUserByUUID(
      UUID.from(createRequestChatDto.requesterUUID),
    );
    const alreadyExisting =
      await this.requestChatRepository.chatAlreadyExistsForRequester(
        requester.id,
      );
    if (alreadyExisting) {
      throw new ConflictException(
        `User with ID ${requester.id.value} has already created a request chat`,
      );
    }
    const requestChat = RequestChatEntity.asNew(
      requester,
      createRequestChatDto.interests,
      createRequestChatDto.whereYouFoundUs,
    );
    const bot = await this.userService.getBotUser();
    const welcome = requestChat.welcomeMessage(bot, this.clock.now());
    await this.requestChatRepository.createRequestChat(requestChat);
    await this.messageRepository.insert(welcome);
    const view = { requestChat, messages: [welcome] };
    this.chatGateway.emitNewRequestChat(view, requester);
    await this.telegramBotService.sendMessageToGroup(
      requestChat.announceWelcomeMesssage(),
    );
    return view;
  }

  /**
   * Una solicitud con sus mensajes. Marca como leídos los que `viewer` no había leído
   * (T11 lo pasa a una operación explícita: un GET no debería escribir).
   */
  async getRequestChatByUUID(
    id: UUID,
    viewer: UserEntity,
  ): Promise<RequestChatView> {
    const [requestChat, messages] = await Promise.all([
      this.findRequestChat(id),
      this.messageRepository.findByRequestChat(id),
    ]);
    const at = new Date();
    const unread = messages.filter((message) => message.markReadBy(viewer, at));
    if (unread.length > 0) {
      await this.messageRepository.markAllReadBy(id, viewer, at);
    }
    return { requestChat, messages };
  }

  /**
   * Agrega un mensaje con una sola inserción: los envíos concurrentes no se pisan ni
   * reescriben la solicitud (RNF-CON-01).
   */
  async addMessageToRequestChat(
    requestChatUUID: UUID,
    user: UserEntity,
    content: string,
  ): Promise<RequestChatMessageEntity> {
    this.logger.debug(
      `Adding message to request chat UUID: ${requestChatUUID.value} from user UUID: ${user.id.value}`,
    );
    const requestChat = await this.findRequestChat(requestChatUUID);
    if (!requestChat.isInProgress()) {
      throw new ConflictException(
        `Cannot add messages to a request chat that is not in progress`,
      );
    }
    const message = RequestChatMessageEntity.send(
      requestChat.id,
      user,
      content,
      this.clock.now(),
    );
    await this.messageRepository.insert(message);
    if (message.fromUser(requestChat.props.requester)) {
      await this.telegramBotService.sendMessageToGroup(
        `Nuevo mensaje de *${requestChat.props.requester.name}* en el chat de solicitud`,
      );
    } else {
      await this.telegramBotService.sendMessageToUser(
        requestChat.props.requester.telegramId,
        requestChat.getNewMessageNotificationText(),
      );
    }
    return message;
  }

  async findRequestChatSummaryOf(
    user: UserEntity,
  ): Promise<RequestChatSummary | null> {
    return this.requestChatRepository.findSummaryByRequester(user.id);
  }

  /** Todas las solicitudes y sus mensajes (T40 lo cambia por un resumen agregado). */
  async getAllRequestChats(): Promise<{
    requestChats: RequestChatEntity[];
    messagesByChat: Map<string, RequestChatMessageEntity[]>;
  }> {
    this.logger.debug(`Fetching all request chats`);
    const requestChats = await this.requestChatRepository.getAllRequestChats();
    const messagesByChat = await this.messageRepository.findByRequestChats(
      requestChats.map((chat) => chat.id),
    );
    return { requestChats, messagesByChat };
  }

  async voteOnRequestChat(
    requestChatUUID: UUID,
    user: UserEntity,
    type: 'approve' | 'reject',
  ): Promise<RequestChatView> {
    this.logger.debug(
      `User UUID: ${user.id.value} voting on request chat UUID: ${requestChatUUID.value} with type: ${type}`,
    );
    const requestChat = await this.findRequestChat(requestChatUUID);
    if (!requestChat.isInProgress()) {
      throw new ConflictException(
        `Cannot vote on a request chat that is not in progress`,
      );
    }
    requestChat.addVote(
      RequestChatVoteEntity.create({ createdAt: DateTime.now(), user, type }),
    );
    await this.requestChatRepository.saveRequestChat(requestChat);
    const closed = !requestChat.isInProgress();
    if (closed) {
      const bot = await this.userService.getBotUser();
      await this.messageRepository.insert(
        requestChat.isApproved()
          ? requestChat.approvedMessage(bot, this.clock.now())
          : requestChat.rejectedMessage(bot, this.clock.now()),
      );
    }
    const view = {
      requestChat,
      messages: await this.messageRepository.findByRequestChat(requestChat.id),
    };
    if (!closed) {
      return view;
    }
    this.chatGateway.emitRequestChatUpdate(view, user);
    if (requestChat.isApproved()) {
      await this.telegramBotService.sendMessageToGroup(
        requestChat.announceApproval(),
      );
      await this.telegramBotService.sendInviteLinkToUser(
        requestChat.props.requester.telegramId,
      );
    } else {
      await this.telegramBotService.sendMessageToGroup(
        requestChat.announceRejection(),
      );
    }
    return view;
  }

  private async findRequestChat(id: UUID): Promise<RequestChatEntity> {
    const requestChat =
      await this.requestChatRepository.getRequestChatByUUID(id);
    if (!requestChat) {
      throw new NotFoundException(`RequestChat with ID ${id.value} not found`);
    }
    return requestChat;
  }
}
