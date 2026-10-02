import { ConflictException, NotFoundException } from '@nestjs/common';
import type { UserService } from 'src/members/application/user.service';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import type { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { RequestChatVoteEntity } from '../domain/entities/request-chat-vote.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import type { ChatRepository } from '../domain/services/chat.repository';
import type { RequestChatMessageRepository } from '../domain/services/request-chat-message.repository';
import type { ChatGateway } from '../presentation/chat.gateway';
import { ChatService } from './chat.service';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

const requester = user(1);
const bot = user(999);

/** Solicitud en curso con `approves` aprobaciones de otros miembros. */
function requestChatWith(approves: number): RequestChatEntity {
  const requestChat = RequestChatEntity.asNew(requester, 'furros');
  for (let i = 0; i < approves; i++) {
    requestChat.addVote(RequestChatVoteEntity.asApprove(user(100 + i)));
  }
  return requestChat;
}

function setup(stored: RequestChatEntity) {
  // Funciones sueltas (no métodos) para poder pasarlas a `expect`.
  const chats = {
    getRequestChatByUUID: jest.fn(() => Promise.resolve(stored)),
    applyVote: jest.fn(() => Promise.resolve<RequestChatEntity | null>(stored)),
    close: jest.fn(() => Promise.resolve(true)),
  };
  const messages = {
    insert: jest.fn(() => Promise.resolve()),
    findByRequestChat: jest.fn(() => Promise.resolve([])),
    markAllReadBy: jest.fn(() => Promise.resolve()),
  };
  const telegram = {
    sendMessageToGroup: jest.fn(() => Promise.resolve()),
    sendInviteLinkToUser: jest.fn(() => Promise.resolve()),
  };
  const gateway = { emitRequestChatUpdate: jest.fn() };
  const service = new ChatService(
    chats as unknown as ChatRepository,
    messages as unknown as RequestChatMessageRepository,
    { getBotUser: () => Promise.resolve(bot) } as unknown as UserService,
    telegram as unknown as TelegramBotService,
    gateway as unknown as ChatGateway,
  );
  return { service, chats, messages, telegram, gateway };
}

describe('ChatService', () => {
  describe('getRequestChatByUUID', () => {
    it('solo lee: no marca leídos ni escribe nada', async () => {
      const { service, chats, messages } = setup(requestChatWith(0));

      await service.getRequestChatByUUID(requestChatWith(0).id);

      expect(messages.markAllReadBy).not.toHaveBeenCalled();
      expect(messages.insert).not.toHaveBeenCalled();
      expect(chats.applyVote).not.toHaveBeenCalled();
      expect(chats.close).not.toHaveBeenCalled();
    });
  });

  describe('markAsRead', () => {
    it('marca todos los mensajes con una sola operación', async () => {
      const stored = requestChatWith(0);
      const { service, messages } = setup(stored);
      const reader = user(2);

      await service.markAsRead(stored.id, reader);

      expect(messages.markAllReadBy).toHaveBeenCalledTimes(1);
      expect(messages.markAllReadBy).toHaveBeenCalledWith(
        stored.id,
        reader,
        expect.any(Date),
      );
    });

    it('una solicitud que no existe → 404', async () => {
      const { service, chats, messages } = setup(requestChatWith(0));
      chats.getRequestChatByUUID.mockResolvedValue(
        null as unknown as RequestChatEntity,
      );

      await expect(
        service.markAsRead(requestChatWith(0).id, user(2)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(messages.markAllReadBy).not.toHaveBeenCalled();
    });
  });

  describe('voteOnRequestChat', () => {
    it('guarda solo el voto, con la operación atómica del repositorio', async () => {
      const stored = requestChatWith(0);
      const { service, chats, messages, telegram } = setup(stored);
      const member = user(2);

      await service.voteOnRequestChat(stored.id, member, 'approve');

      expect(chats.applyVote).toHaveBeenCalledWith(
        stored.id,
        expect.objectContaining({ kind: 'set' }),
        expect.any(Date),
      );
      expect(chats.close).not.toHaveBeenCalled();
      expect(messages.insert).not.toHaveBeenCalled();
      expect(telegram.sendMessageToGroup).not.toHaveBeenCalled();
    });

    it('al cruzar el umbral cierra, agrega el mensaje de cierre y avisa una vez', async () => {
      const { service, chats, messages, telegram, gateway } = setup(
        requestChatWith(5),
      );

      const { requestChat } = await service.voteOnRequestChat(
        requestChatWith(0).id,
        user(2),
        'approve',
      );

      expect(chats.close).toHaveBeenCalledTimes(1);
      expect(requestChat.isApproved()).toBe(true);
      expect(messages.insert).toHaveBeenCalledTimes(1);
      expect(gateway.emitRequestChatUpdate).toHaveBeenCalledTimes(1);
      expect(telegram.sendMessageToGroup).toHaveBeenCalledTimes(1);
      expect(telegram.sendInviteLinkToUser).toHaveBeenCalledWith(
        requester.telegramId,
      );
    });

    it('si otro voto la cerró primero, no repite el mensaje ni los avisos', async () => {
      const closedByOther = requestChatWith(5);
      closedByOther.close(closedByOther.outcome()!);
      const { service, chats, messages, telegram, gateway } = setup(
        requestChatWith(5),
      );
      chats.close.mockResolvedValue(false);
      chats.getRequestChatByUUID
        .mockResolvedValueOnce(requestChatWith(4))
        .mockResolvedValueOnce(closedByOther);

      const { requestChat } = await service.voteOnRequestChat(
        closedByOther.id,
        user(2),
        'approve',
      );

      expect(requestChat.isApproved()).toBe(true);
      expect(messages.insert).not.toHaveBeenCalled();
      expect(gateway.emitRequestChatUpdate).not.toHaveBeenCalled();
      expect(telegram.sendMessageToGroup).not.toHaveBeenCalled();
    });

    it('si la solicitud se cerró antes de guardar el voto → 409', async () => {
      const { service, chats } = setup(requestChatWith(0));
      chats.applyVote.mockResolvedValue(null);

      await expect(
        service.voteOnRequestChat(requestChatWith(0).id, user(2), 'approve'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
