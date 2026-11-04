import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CHAT_PROVIDERS } from '../chat.providers';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { reviewRejection } from './review-rejection';
import {
  type VoteThresholds,
  voteThresholdsFrom,
  type Votes,
  type VoteType,
} from 'src/review/domain/vote';
import {
  DuplicateRequestChatError,
  type ChatRepository,
  type RequestChatCursor,
  type RequestChatHeader,
  type RequestChatPage,
  type RequestChatSummary,
} from '../domain/services/chat.repository';
import type {
  InsertedMessage,
  MessagesPage,
  RequestChatMessageRepository,
} from '../domain/services/request-chat-message.repository';
import {
  InvalidMessageError,
  type MessageBody,
  RequestChatMessageEntity,
} from '../domain/entities/request-chat-message.entity';
import { MediaService } from 'src/media/application/media.service';
import { UserService } from 'src/members/application/user.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { ChatGateway } from '../presentation/chat.gateway';
import { MonotonicClock } from 'src/shared/time/monotonic-clock';
import { BackgroundQueue } from 'src/shared/async/background-queue';
import {
  RequestChatState,
  type RequestChatStateType,
} from '../domain/value-objects/request-chat-state.value-object';
import { RequestChatAccessService } from './request-chat-access.service';

/** Cuántos mensajes trae abrir un chat; los anteriores se piden por páginas (T18). */
export const LATEST_MESSAGES_LIMIT = 50;

/** Una solicitud con sus últimos mensajes, en orden cronológico. */
export interface RequestChatView {
  requestChat: RequestChatEntity;
  messages: RequestChatMessageEntity[];
  /** Hay mensajes anteriores a `messages`: se piden con `before`. */
  hasOlder: boolean;
  /** Los umbrales vigentes, para mostrar la votación a los miembros. */
  thresholds: VoteThresholds;
}

/** Cómo quedó una solicitud tras el voto de un miembro. */
export interface VoteResult {
  requestChatId: UUID;
  state: RequestChatStateType;
  /** Los votos guardados. Hacia afuera solo salen conteos. */
  votes: Votes;
  thresholds: VoteThresholds;
  /** El voto que le quedó a quien votó; falta si lo retiró. */
  userVote?: VoteType;
}

/**
 * Enviar y votar siguen el mismo orden (RNF-REN-08): guardar con operaciones atómicas,
 * responder y emitir, y recién después avisar por Telegram desde `BackgroundQueue`.
 * Ninguna petición espera a Telegram, y si Telegram falla lo guardado no se pierde.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  /** Fecha de cada mensaje: única y creciente, para que el orden sea el de llegada. */
  private readonly clock = new MonotonicClock();
  /**
   * `APPROVE_THRESHOLD` y `REJECT_THRESHOLD`, leídos al crear el servicio (ya con el `.env`
   * cargado): uno inválido impide arrancar.
   */
  private readonly thresholds = voteThresholdsFrom(process.env);

  constructor(
    @Inject(CHAT_PROVIDERS.RequestChatRepository)
    private readonly requestChatRepository: ChatRepository,
    @Inject(CHAT_PROVIDERS.RequestChatMessageRepository)
    private readonly messageRepository: RequestChatMessageRepository,
    private readonly userService: UserService,
    private readonly telegramBotService: TelegramBotService,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    private readonly access: RequestChatAccessService,
    private readonly background: BackgroundQueue,
    private readonly mediaService: MediaService,
  ) {}

  /**
   * Abre una solicitud nueva, sin mensajes (la bienvenida la muestra la App, SPEC §3.2),
   * avisa a los miembros por socket y anuncia en el grupo en segundo plano. Una por
   * usuario, sin importar su estado (SPEC §3.1): si ya tiene una → 409, también si dos
   * envíos llegan a la vez.
   */
  async openRequestChat(
    requestChat: RequestChatEntity,
  ): Promise<RequestChatView> {
    const requester = requestChat.props.requester;
    if (
      await this.requestChatRepository.chatAlreadyExistsForRequester(
        requester.id,
      )
    ) {
      throw this.alreadyApplied();
    }
    try {
      await this.requestChatRepository.createRequestChat(requestChat);
    } catch (error) {
      // El índice único de `requester` resuelve dos envíos simultáneos.
      throw error instanceof DuplicateRequestChatError
        ? this.alreadyApplied()
        : error;
    }
    const view: RequestChatView = {
      requestChat,
      messages: [],
      hasOlder: false,
      thresholds: this.thresholds,
    };
    this.chatGateway.emitNewRequestChat(view);
    this.notifyGroup(
      'aviso de solicitud nueva',
      requestChat.announceWelcomeMesssage(),
    );
    return view;
  }

  /** Una solicitud con su última página de mensajes. Solo lee. */
  async getRequestChatByUUID(id: UUID): Promise<RequestChatView> {
    const [requestChat, page] = await Promise.all([
      this.findRequestChat(id),
      this.messageRepository.findLatest(id, LATEST_MESSAGES_LIMIT),
    ]);
    return {
      requestChat,
      messages: page.items,
      hasOlder: page.hasMore,
      thresholds: this.thresholds,
    };
  }

  /**
   * Agrega un mensaje de `author`, que debe ser miembro o el solicitante. Un mensaje de
   * texto son dos operaciones de Mongo: leer solicitante y estado, e insertar; los envíos
   * concurrentes no se pisan ni reescriben la solicitud (RNF-CON-01). Las imágenes suman
   * validarlas y, si escribe un miembro, compartirlas con el solicitante. El aviso de
   * Telegram queda en segundo plano.
   *
   * Con `clientMessageId`, un reenvío devuelve el mensaje ya guardado (`created: false`)
   * y no vuelve a avisar. Un cuerpo inválido o imágenes ajenas → 400. Una solicitud
   * cerrada → `RequestChatClosedError` (solo lectura, SPEC §3.2).
   */
  async addMessageToRequestChat(
    requestChatUUID: UUID,
    author: UserEntity,
    body: MessageBody,
    clientMessageId?: string,
  ): Promise<InsertedMessage> {
    this.logger.debug(
      `Adding message to request chat UUID: ${requestChatUUID.value} from user UUID: ${author.id.value}`,
    );
    const header = await this.requestChatRepository.findHeader(requestChatUUID);
    // Primero el acceso: a quien no es miembro no se le revela si la solicitud existe.
    if (!(await this.access.canAccessLoaded(author, header))) {
      throw new ForbiddenException();
    }
    if (!header) {
      throw this.notFound(requestChatUUID);
    }
    RequestChatEntity.assertAcceptsMessages(header.id, header.state);
    let message: RequestChatMessageEntity;
    try {
      message = RequestChatMessageEntity.send(
        header.id,
        author,
        body,
        this.clock.now(),
        clientMessageId,
      );
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        throw new BadRequestException(error.reason);
      }
      throw error;
    }
    if (message.imageIds.length) {
      await this.mediaService.assertOwnUploads(author, message.imageIds);
      // Antes de emitir: el solicitante ya puede abrir las imágenes al recibir el evento.
      if (header.requesterId.value !== author.id.value) {
        await this.mediaService.shareUploads(
          message.imageIds,
          header.requesterId.value,
        );
      }
    }
    const inserted = await this.messageRepository.insertOnce(message);
    if (inserted.created) {
      this.notifyNewMessage(header, inserted.message);
    }
    return inserted;
  }

  /**
   * Una página de mensajes junto a otro: los anteriores a `before` (historial, T18) o los
   * posteriores a `after` (recuperar lo perdido al reconectar, T16). La ruta ya autorizó
   * al usuario (`OwnerOrMember`). Un mensaje de otra solicitud → 400.
   */
  async getMessages(
    requestChatId: UUID,
    cursor: { before: UUID } | { after: UUID },
    limit: number,
  ): Promise<MessagesPage> {
    const older = 'before' in cursor;
    const page = older
      ? await this.messageRepository.findBefore(
          requestChatId,
          cursor.before,
          limit,
        )
      : await this.messageRepository.findAfter(
          requestChatId,
          cursor.after,
          limit,
        );
    if (!page) {
      throw new BadRequestException(
        `${older ? 'before' : 'after'} must be a message of this request chat`,
      );
    }
    return page;
  }

  async findRequestChatSummaryOf(
    user: UserEntity,
  ): Promise<RequestChatSummary | null> {
    return this.requestChatRepository.findSummaryByRequester(user.id);
  }

  /** Una página del listado, con el resumen de cada solicitud para `viewer`. */
  async listRequestChats(
    viewer: UserEntity,
    page: { limit: number; after?: RequestChatCursor },
  ): Promise<RequestChatPage> {
    return this.requestChatRepository.listSummaries(viewer.id, page);
  }

  /**
   * Guarda el voto con una operación atómica y, si cruza un umbral, cierra la solicitud
   * con otra (condicional: se cierra una sola vez). El aviso por socket del cierre y los
   * de Telegram quedan en segundo plano: la respuesta lleva estado y votación. Votar la
   * propia solicitud → 403; una cerrada → 409.
   */
  async voteOnRequestChat(
    requestChatUUID: UUID,
    user: UserEntity,
    type: VoteType,
  ): Promise<VoteResult> {
    // Sin log de quién vota ni de qué: los votos son anónimos (RNF-PRI-01).
    const votes = await this.requestChatRepository.toggleVote(
      requestChatUUID,
      user.id,
      type,
      new Date(),
    );
    if (!votes) {
      throw await reviewRejection(
        this.requestChatRepository,
        requestChatUUID,
        user.id,
      );
    }
    let state = RequestChatState.InProgress().props.value;
    // Si varios votos cruzan el umbral a la vez, solo uno cierra la solicitud: ese avisa,
    // una sola vez.
    const outcome = RequestChatEntity.outcomeFor(votes, this.thresholds);
    if (outcome) {
      if (await this.requestChatRepository.close(requestChatUUID, outcome)) {
        state = outcome.props.value;
        this.afterClose(requestChatUUID);
      } else {
        // Otro voto la cerró entre medio (poco común): se informa su estado real.
        state =
          (await this.requestChatRepository.findHeader(requestChatUUID))
            ?.state ?? state;
      }
    }
    const result: VoteResult = {
      requestChatId: requestChatUUID,
      state,
      votes,
      thresholds: this.thresholds,
      userVote: votes.typeOf(user.id),
    };
    // Los demás miembros ven la votación en vivo, sin recargar (T42).
    this.chatGateway.emitVotes(result);
    return result;
  }

  /**
   * Tras cerrar: aviso por socket (el solicitante pasa a la pantalla del resultado) y
   * avisos de Telegram. El chat no recibe ningún mensaje de cierre (SPEC §3.2). No se
   * reintenta, para no repetir los avisos al grupo.
   */
  private afterClose(id: UUID): void {
    this.background.enqueue(
      'cierre de solicitud',
      async () => {
        const [requestChat, page] = await Promise.all([
          this.findRequestChat(id),
          this.messageRepository.findLatest(id, LATEST_MESSAGES_LIMIT),
        ]);
        this.chatGateway.emitRequestChatUpdate({
          requestChat,
          messages: page.items,
          hasOlder: page.hasMore,
          thresholds: this.thresholds,
        });
        this.notifyClosed(requestChat);
      },
      { attempts: 1 },
    );
  }

  private notifyClosed(requestChat: RequestChatEntity): void {
    const requester = requestChat.props.requester;
    if (requestChat.isApproved()) {
      this.notifyGroup('aviso de aprobación', requestChat.announceApproval());
      this.background.enqueue('enlace de invitación', () =>
        this.telegramBotService.sendInviteLinkToUser(requester.telegramId),
      );
    } else {
      this.notifyGroup('aviso de rechazo', requestChat.announceRejection());
    }
  }

  /**
   * Si escribe el solicitante, su mensaje llega al grupo con el enlace a la solicitud;
   * si escribe un miembro, se avisa al solicitante.
   */
  private notifyNewMessage(
    header: RequestChatHeader,
    message: RequestChatMessageEntity,
  ): void {
    const author = message.author;
    if (header.requesterId.value === author.id.value) {
      this.notifyGroup(
        'aviso de mensaje al grupo',
        RequestChatEntity.requesterMessageNotice(
          header.id,
          author,
          message.preview,
        ),
      );
      return;
    }
    this.background.enqueue('aviso de mensaje al solicitante', async () => {
      const requester = await this.userService.getUserByUUID(
        header.requesterId,
      );
      await this.telegramBotService.sendMessageToUser(
        requester.telegramId,
        RequestChatEntity.newMessageNotificationText(requester),
      );
    });
  }

  private notifyGroup(name: string, text: string): void {
    this.background.enqueue(name, () =>
      this.telegramBotService.sendMessageToGroup(text),
    );
  }

  private alreadyApplied(): ConflictException {
    return new ConflictException('The user already has a request chat');
  }

  private notFound(id: UUID): NotFoundException {
    return new NotFoundException(`RequestChat with ID ${id.value} not found`);
  }

  private async findRequestChat(id: UUID): Promise<RequestChatEntity> {
    const requestChat =
      await this.requestChatRepository.getRequestChatByUUID(id);
    if (!requestChat) {
      throw this.notFound(id);
    }
    return requestChat;
  }
}
