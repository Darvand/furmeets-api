import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { UserService } from 'src/members/application/user.service';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { BackgroundQueue } from 'src/shared/async/background-queue';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import {
  DuplicateRequestChatError,
  type ChatRepository,
  type RequestChatHeader,
  type VoteApplied,
} from '../domain/services/chat.repository';
import { ApplicationForm } from 'src/applications/domain/application-form';
import type {
  MessagesPage,
  RequestChatMessageRepository,
} from '../domain/services/request-chat-message.repository';
import type { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { RequestChatState } from '../domain/value-objects/request-chat-state.value-object';
import type { ChatGateway } from '../presentation/chat.gateway';
import type { MediaService } from 'src/media/application/media.service';
import { ChatService, LATEST_MESSAGES_LIMIT } from './chat.service';
import type { RequestChatAccessService } from './request-chat-access.service';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

const requester = user(1);
const member = user(2);
const bot = user(999);

/** Una promesa que no termina hasta que la prueba la suelta: un Telegram lento. */
function slowTelegram() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  return { call: jest.fn(() => done), release };
}

/**
 * Frena la cola hasta `release`, para contar solo las operaciones del camino crítico:
 * si no, las tareas en segundo plano arrancan antes de que la prueba cuente.
 */
function holdQueue(queue: BackgroundQueue) {
  const gate = slowTelegram();
  queue.enqueue('compuerta', gate.call);
  return gate.release;
}

function setup({ state = 'InProgress', approves = 0 } = {}) {
  const requestChat = RequestChatEntity.apply(
    requester,
    ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
  );
  if (state !== 'InProgress') {
    requestChat.props.state = RequestChatState.create(state);
  }
  const header: RequestChatHeader = {
    id: requestChat.id,
    requesterId: requester.id,
    state: requestChat.state,
  };
  const voted = (approved: number): VoteApplied => ({
    votes: { approved, rejected: 0 },
    voterVote: 'approve',
  });
  // Funciones sueltas (no métodos) para poder pasarlas a `expect`.
  const chats = {
    findHeader: jest.fn(() =>
      Promise.resolve<RequestChatHeader | null>(header),
    ),
    toggleVote: jest.fn(() =>
      Promise.resolve<VoteApplied | null>(voted(approves)),
    ),
    close: jest.fn(() => Promise.resolve(true)),
    getRequestChatByUUID: jest.fn(() =>
      Promise.resolve<RequestChatEntity | null>(requestChat),
    ),
    chatAlreadyExistsForRequester: jest.fn(() => Promise.resolve(false)),
    createRequestChat: jest.fn(() => Promise.resolve()),
  };
  const messages = {
    insert: jest.fn(() => Promise.resolve()),
    insertOnce: jest.fn((message: RequestChatMessageEntity) =>
      Promise.resolve({ message, created: true }),
    ),
    findAfter: jest.fn(() => Promise.resolve<MessagesPage | null>(null)),
    findBefore: jest.fn(() => Promise.resolve<MessagesPage | null>(null)),
    findLatest: jest.fn(() =>
      Promise.resolve<MessagesPage>({ items: [], hasMore: false }),
    ),
  };
  const users = {
    getBotUser: jest.fn(() => Promise.resolve(bot)),
    getUserByUUID: jest.fn(() => Promise.resolve(requester)),
  };
  const telegram = {
    sendMessageToGroup: jest.fn(() => Promise.resolve()),
    sendMessageToUser: jest.fn(() => Promise.resolve()),
    sendInviteLinkToUser: jest.fn(() => Promise.resolve()),
  };
  const gateway = {
    emitRequestChatUpdate: jest.fn(),
    emitVotes: jest.fn(),
    emitNewRequestChat: jest.fn(),
  };
  const access = {
    canAccessLoaded: jest.fn(() => Promise.resolve(true)),
  };
  const media = {
    assertOwnUploads: jest.fn(() => Promise.resolve()),
    shareUploads: jest.fn(() => Promise.resolve()),
  };
  const queueLogger = { warn: jest.fn(), error: jest.fn() };
  const queue = new BackgroundQueue(queueLogger as unknown as Logger, {
    retryDelayMs: 1,
  });
  const service = new ChatService(
    chats as unknown as ChatRepository,
    messages as unknown as RequestChatMessageRepository,
    users as unknown as UserService,
    telegram as unknown as TelegramBotService,
    gateway as unknown as ChatGateway,
    access as unknown as RequestChatAccessService,
    queue,
    media as unknown as MediaService,
  );
  /** Operaciones de Mongo hechas hasta ahora. */
  const mongoOps = () =>
    [...Object.values(chats), ...Object.values(messages)].reduce(
      (total, fn) => total + fn.mock.calls.length,
      0,
    );
  return {
    service,
    requestChat,
    chats,
    messages,
    users,
    telegram,
    gateway,
    access,
    media,
    queue,
    queueLogger,
    mongoOps,
  };
}

describe('ChatService', () => {
  describe('openRequestChat', () => {
    const application = () =>
      RequestChatEntity.apply(
        requester,
        ApplicationForm.submit({
          age: 16,
          city: 'Bogotá',
        }),
      );

    it('abre la solicitud con su bienvenida, avisa a los miembros y anuncia después', async () => {
      const ctx = setup();
      const requestChat = application();

      const view = await ctx.service.openRequestChat(requestChat);

      expect(ctx.chats.createRequestChat).toHaveBeenCalledWith(requestChat);
      expect(view.messages).toHaveLength(1);
      expect(ctx.gateway.emitNewRequestChat).toHaveBeenCalledWith(
        view,
        requester,
      );
      await ctx.queue.drain();
      const announcement = ctx.telegram.sendMessageToGroup.mock
        .calls[0] as unknown as [string];
      expect(announcement[0]).toContain('*Edad:* 16');
      expect(announcement[0]).toContain('*Ciudad:* Bogotá');
      // Sin las líneas del formulario anterior ni la etiqueta de menor.
      expect(announcement[0]).not.toContain('intereses');
      expect(announcement[0]).not.toContain('Menor de edad');
    });

    it('una por usuario: si ya tiene una (en cualquier estado) → 409', async () => {
      const ctx = setup();
      ctx.chats.chatAlreadyExistsForRequester.mockResolvedValue(true);

      await expect(
        ctx.service.openRequestChat(application()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.chats.createRequestChat).not.toHaveBeenCalled();
    });

    it('si otro envío se adelanta (índice único) → 409 y no deja mensajes', async () => {
      const ctx = setup();
      ctx.chats.createRequestChat.mockRejectedValue(
        new DuplicateRequestChatError(),
      );

      await expect(
        ctx.service.openRequestChat(application()),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.messages.insert).not.toHaveBeenCalled();
      expect(ctx.gateway.emitNewRequestChat).not.toHaveBeenCalled();
    });
  });

  describe('getRequestChatByUUID', () => {
    it('solo lee: no escribe nada', async () => {
      const { service, requestChat, chats, messages } = setup();

      await service.getRequestChatByUUID(requestChat.id);

      expect(messages.insert).not.toHaveBeenCalled();
      expect(chats.toggleVote).not.toHaveBeenCalled();
      expect(chats.close).not.toHaveBeenCalled();
    });

    it('trae solo la última página de mensajes y si hay anteriores', async () => {
      const { service, requestChat, messages } = setup();
      messages.findLatest.mockResolvedValue({ items: [], hasMore: true });

      const view = await service.getRequestChatByUUID(requestChat.id);

      expect(messages.findLatest).toHaveBeenCalledWith(
        requestChat.id,
        LATEST_MESSAGES_LIMIT,
      );
      expect(view.hasOlder).toBe(true);
    });
  });

  describe('addMessageToRequestChat', () => {
    it('guarda con 2 operaciones de Mongo y vuelve sin esperar a Telegram', async () => {
      const ctx = setup();
      const slow = slowTelegram();
      ctx.telegram.sendMessageToGroup = slow.call;
      const resume = holdQueue(ctx.queue);

      const { message } = await ctx.service.addMessageToRequestChat(
        ctx.requestChat.id,
        requester,
        { content: 'hola' },
      );

      expect(message.content).toBe('hola');
      expect(ctx.chats.findHeader).toHaveBeenCalledTimes(1);
      expect(ctx.messages.insertOnce).toHaveBeenCalledTimes(1);
      expect(ctx.mongoOps()).toBe(2);
      resume();
      // Telegram sigue sin responder y el mensaje ya está guardado.
      slow.release();
      await ctx.queue.drain();
      const notice = (slow.call.mock.calls[0] as unknown as [string])[0];
      expect(notice).toContain('User 1');
      expect(notice).toContain('hola');
      expect(notice).toContain(`startapp=${ctx.requestChat.id.value}`);
    });

    it('si escribe un miembro, avisa al solicitante en segundo plano', async () => {
      const ctx = setup();
      const resume = holdQueue(ctx.queue);

      await ctx.service.addMessageToRequestChat(ctx.requestChat.id, member, {
        content: 'hola',
      });
      expect(ctx.mongoOps()).toBe(2);
      resume();
      await ctx.queue.drain();

      expect(ctx.telegram.sendMessageToUser).toHaveBeenCalledWith(
        requester.telegramId,
        expect.stringContaining('tienes un mensaje nuevo'),
      );
      expect(ctx.telegram.sendMessageToGroup).not.toHaveBeenCalled();
    });

    it('si Telegram falla, el mensaje queda guardado y el error se registra', async () => {
      const ctx = setup();
      ctx.telegram.sendMessageToGroup.mockRejectedValue(new Error('caído'));

      await expect(
        ctx.service.addMessageToRequestChat(ctx.requestChat.id, requester, {
          content: 'x',
        }),
      ).resolves.toBeDefined();
      await ctx.queue.drain();

      expect(ctx.messages.insertOnce).toHaveBeenCalledTimes(1);
      expect(ctx.telegram.sendMessageToGroup).toHaveBeenCalledTimes(3);
      expect(ctx.queueLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('caído'),
      );
    });

    it('guarda el clientMessageId con el mensaje', async () => {
      const ctx = setup();

      const { message, created } = await ctx.service.addMessageToRequestChat(
        ctx.requestChat.id,
        requester,
        { content: 'hola' },
        'cliente-1',
      );

      expect(created).toBe(true);
      expect(message.clientMessageId).toBe('cliente-1');
    });

    it('un reenvío devuelve el mensaje guardado y no vuelve a avisar', async () => {
      const ctx = setup();
      ctx.messages.insertOnce.mockImplementation(
        (message: RequestChatMessageEntity) =>
          Promise.resolve({ message, created: false }),
      );

      const { created } = await ctx.service.addMessageToRequestChat(
        ctx.requestChat.id,
        requester,
        { content: 'hola' },
        'cliente-1',
      );
      await ctx.queue.drain();

      expect(created).toBe(false);
      expect(ctx.telegram.sendMessageToGroup).not.toHaveBeenCalled();
    });

    it('imágenes de un miembro: valida que sean suyas y las comparte con el solicitante', async () => {
      const ctx = setup();

      const { message } = await ctx.service.addMessageToRequestChat(
        ctx.requestChat.id,
        member,
        { imageIds: ['img-1'] },
      );

      expect(message.imageIds).toEqual(['img-1']);
      expect(ctx.media.assertOwnUploads).toHaveBeenCalledWith(member, [
        'img-1',
      ]);
      expect(ctx.media.shareUploads).toHaveBeenCalledWith(
        ['img-1'],
        requester.id.value,
      );
    });

    it('imágenes del solicitante: no hace falta compartirlas (los miembros ven todas)', async () => {
      const ctx = setup();

      await ctx.service.addMessageToRequestChat(ctx.requestChat.id, requester, {
        imageIds: ['img-1'],
      });

      expect(ctx.media.assertOwnUploads).toHaveBeenCalled();
      expect(ctx.media.shareUploads).not.toHaveBeenCalled();
    });

    it('imágenes ajenas → 400 y no guarda nada', async () => {
      const ctx = setup();
      ctx.media.assertOwnUploads.mockRejectedValue(new BadRequestException());

      await expect(
        ctx.service.addMessageToRequestChat(ctx.requestChat.id, member, {
          imageIds: ['ajena'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(ctx.messages.insertOnce).not.toHaveBeenCalled();
    });

    it('sin texto ni imágenes → 400', async () => {
      const ctx = setup();

      await expect(
        ctx.service.addMessageToRequestChat(ctx.requestChat.id, member, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin acceso → 403 y no guarda nada', async () => {
      const ctx = setup();
      ctx.access.canAccessLoaded.mockResolvedValue(false);

      await expect(
        ctx.service.addMessageToRequestChat(ctx.requestChat.id, member, {
          content: 'x',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(ctx.messages.insertOnce).not.toHaveBeenCalled();
    });

    it('en una solicitud cerrada → 409', async () => {
      const ctx = setup({ state: 'Approved' });

      await expect(
        ctx.service.addMessageToRequestChat(ctx.requestChat.id, member, {
          content: 'x',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.messages.insertOnce).not.toHaveBeenCalled();
    });
  });

  describe('getMessages', () => {
    it.each(['before', 'after'] as const)(
      'un %s que no es de la solicitud → 400',
      async (name) => {
        const ctx = setup();
        const cursor =
          name === 'before'
            ? { before: UUID.generate() }
            : { after: UUID.generate() };

        await expect(
          ctx.service.getMessages(ctx.requestChat.id, cursor, 10),
        ).rejects.toThrow(`${name} must be a message of this request chat`);
      },
    );

    it('con before pide los anteriores; con after, los posteriores', async () => {
      const ctx = setup();
      const older = { items: [], hasMore: true };
      const newer = { items: [], hasMore: false };
      ctx.messages.findBefore.mockResolvedValue(older);
      ctx.messages.findAfter.mockResolvedValue(newer);
      const anchor = UUID.generate();

      await expect(
        ctx.service.getMessages(ctx.requestChat.id, { before: anchor }, 10),
      ).resolves.toBe(older);
      await expect(
        ctx.service.getMessages(ctx.requestChat.id, { after: anchor }, 10),
      ).resolves.toBe(newer);
      expect(ctx.messages.findBefore).toHaveBeenCalledWith(
        ctx.requestChat.id,
        anchor,
        10,
      );
    });
  });

  describe('voteOnRequestChat', () => {
    it('guarda solo el voto, con una operación atómica', async () => {
      const ctx = setup({ approves: 1 });

      const result = await ctx.service.voteOnRequestChat(
        ctx.requestChat.id,
        member,
        'approve',
      );

      expect(ctx.chats.toggleVote).toHaveBeenCalledWith(
        ctx.requestChat.id,
        member.id,
        'approve',
        expect.any(Date),
      );
      expect(ctx.mongoOps()).toBe(1);
      expect(result).toEqual({
        requestChatId: ctx.requestChat.id,
        state: 'InProgress',
        votes: { approved: 1, rejected: 0 },
        userVote: 'approve',
      });
      // Los conteos salen en vivo a los miembros, en cuanto se guarda el voto.
      expect(ctx.gateway.emitVotes).toHaveBeenCalledWith(result);
      await ctx.queue.drain();
      expect(ctx.messages.insert).not.toHaveBeenCalled();
      expect(ctx.telegram.sendMessageToGroup).not.toHaveBeenCalled();
    });

    it('al cruzar el umbral cierra con 2 operaciones y avisa después, una vez', async () => {
      const ctx = setup({ approves: 5 });
      const slow = slowTelegram();
      ctx.telegram.sendMessageToGroup = slow.call;
      ctx.chats.getRequestChatByUUID.mockImplementation(() => {
        ctx.requestChat.props.state = RequestChatState.Approved();
        return Promise.resolve(ctx.requestChat);
      });
      const resume = holdQueue(ctx.queue);

      const result = await ctx.service.voteOnRequestChat(
        ctx.requestChat.id,
        member,
        'approve',
      );

      expect(result.state).toBe('Approved');
      expect(ctx.chats.close).toHaveBeenCalledTimes(1);
      expect(ctx.mongoOps()).toBe(2);
      resume();
      slow.release();
      await ctx.queue.drain();
      expect(ctx.messages.insert).toHaveBeenCalledTimes(1);
      expect(ctx.gateway.emitRequestChatUpdate).toHaveBeenCalledTimes(1);
      expect(slow.call).toHaveBeenCalledTimes(1);
      expect(ctx.telegram.sendInviteLinkToUser).toHaveBeenCalledWith(
        requester.telegramId,
      );
    });

    it('si Telegram falla al cerrar, la solicitud queda cerrada y avisada por socket', async () => {
      const ctx = setup({ approves: 5 });
      ctx.chats.getRequestChatByUUID.mockImplementation(() => {
        ctx.requestChat.props.state = RequestChatState.Approved();
        return Promise.resolve(ctx.requestChat);
      });
      ctx.telegram.sendMessageToGroup.mockRejectedValue(new Error('caído'));
      ctx.telegram.sendInviteLinkToUser.mockRejectedValue(new Error('caído'));

      const result = await ctx.service.voteOnRequestChat(
        ctx.requestChat.id,
        member,
        'approve',
      );
      await ctx.queue.drain();

      expect(result.state).toBe('Approved');
      expect(ctx.messages.insert).toHaveBeenCalledTimes(1);
      expect(ctx.gateway.emitRequestChatUpdate).toHaveBeenCalledTimes(1);
      expect(ctx.queueLogger.error).toHaveBeenCalledTimes(2);
    });

    it('si otro voto la cerró primero, no repite el mensaje ni los avisos', async () => {
      const ctx = setup({ approves: 5 });
      ctx.chats.close.mockResolvedValue(false);
      ctx.requestChat.props.state = RequestChatState.Approved();

      const result = await ctx.service.voteOnRequestChat(
        ctx.requestChat.id,
        member,
        'approve',
      );
      await ctx.queue.drain();

      expect(result.state).toBe('Approved');
      expect(ctx.messages.insert).not.toHaveBeenCalled();
      expect(ctx.gateway.emitRequestChatUpdate).not.toHaveBeenCalled();
      expect(ctx.telegram.sendMessageToGroup).not.toHaveBeenCalled();
    });

    it('si la solicitud ya no está en curso → 409', async () => {
      const ctx = setup();
      ctx.chats.toggleVote.mockResolvedValue(null);

      await expect(
        ctx.service.voteOnRequestChat(ctx.requestChat.id, member, 'approve'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('si la solicitud no existe → 404', async () => {
      const ctx = setup();
      ctx.chats.toggleVote.mockResolvedValue(null);
      ctx.chats.getRequestChatByUUID.mockResolvedValue(null);

      await expect(
        ctx.service.voteOnRequestChat(UUID.generate(), member, 'approve'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
