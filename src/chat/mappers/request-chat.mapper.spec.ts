import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { ApplicationForm } from 'src/applications/domain/application-form';
import { RequestChatMapper } from './request-chat.mapper';
import { BadRequestException } from '@nestjs/common';
import type { RequestChatListItem } from '../domain/services/chat.repository';
import { RequestChatCursorCodec } from '../presentation/request-chat-cursor';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatMapper', () => {
  const requester = user(1);
  const bot = user(999);
  const requestChat = RequestChatEntity.apply(
    requester,
    ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
  );
  const welcome = requestChat.welcomeMessage(
    bot,
    new Date('2026-10-02T15:00:00.000Z'),
  );
  const hello = RequestChatMessageEntity.send(
    requestChat.id,
    requester,
    'hola',
    new Date('2026-10-02T15:05:30.123Z'),
  );

  it('las fechas de los mensajes van en ISO-8601 UTC, sin formato del servidor', () => {
    const dto = RequestChatMapper.toDto(
      requestChat,
      [welcome, hello],
      requester,
    );

    expect(dto.messages.map((m) => m.sentAt)).toEqual([
      '2026-10-02T15:00:00.000Z',
      '2026-10-02T15:05:30.123Z',
    ]);
  });

  describe('listado', () => {
    const item: RequestChatListItem = {
      id: requestChat.id,
      requester,
      state: 'InProgress',
      createdAt: new Date('2026-10-02T14:59:59.000Z'),
      lastMessage: {
        author: requester,
        content: 'hola',
        at: new Date('2026-10-02T15:05:30.123Z'),
      },
      votes: { approved: 1, rejected: 2 },
      viewerVote: 'approve',
    };

    it('da el último mensaje y las fechas en ISO UTC, y los conteos de votos tal cual', () => {
      const [dto] = RequestChatMapper.toDtoList({ items: [item] }).items;

      expect(dto).toMatchObject({
        uuid: requestChat.id.value,
        lastMessage: { content: 'hola', at: '2026-10-02T15:05:30.123Z' },
        votes: { approved: 1, rejected: 2 },
        userVote: 'approve',
        createdAt: '2026-10-02T14:59:59.000Z',
      });
    });

    it('una solicitud sin mensajes (sin migrar) sale sin último mensaje', () => {
      const [dto] = RequestChatMapper.toDtoList({
        items: [{ ...item, lastMessage: undefined }],
      }).items;

      expect(dto.lastMessage).toBeUndefined();
    });

    it('el cursor de la página siguiente es opaco y vuelve a la misma posición', () => {
      const next = { createdAt: item.createdAt, id: item.id };
      const { nextCursor } = RequestChatMapper.toDtoList({
        items: [item],
        next,
      });

      expect(nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(RequestChatCursorCodec.decode(nextCursor!)).toEqual(next);
      expect(
        RequestChatMapper.toDtoList({ items: [item] }).nextCursor,
      ).toBeUndefined();
    });

    it.each(['no-es-base64-json', 'WzEsMl0', 'WyJ4IiwieSJd'])(
      'un cursor ajeno (%s) es un 400',
      (raw) => {
        expect(() => RequestChatCursorCodec.decode(raw)).toThrow(
          BadRequestException,
        );
      },
    );
  });
});
