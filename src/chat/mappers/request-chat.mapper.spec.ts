import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { ApplicationForm } from 'src/applications/domain/application-form';
import { RequestChatMapper } from './request-chat.mapper';
import { BadRequestException } from '@nestjs/common';
import type { RequestChatListItem } from '../domain/services/chat.repository';
import { RequestChatCursorCodec } from '../presentation/request-chat-cursor';
import { RequestChatState } from '../domain/value-objects/request-chat-state.value-object';
import { Votes } from 'src/review/domain/vote';
import type { RequestChatView, VoteResult } from '../application/chat.service';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatMapper', () => {
  const requester = user(1);
  const member = user(2);
  const requestChat = RequestChatEntity.apply(
    requester,
    ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
  );
  const first = RequestChatMessageEntity.send(
    requestChat.id,
    member,
    { content: 'hola, Ana' },
    new Date('2026-10-02T15:00:00.000Z'),
  );
  const hello = RequestChatMessageEntity.send(
    requestChat.id,
    requester,
    { content: 'hola' },
    new Date('2026-10-02T15:05:30.123Z'),
  );

  const thresholds = { approve: 5, reject: 5 };

  it('las fechas de los mensajes van en ISO-8601 UTC, sin formato del servidor', () => {
    const dto = RequestChatMapper.toRequesterDto({
      requestChat,
      messages: [first, hello],
      hasOlder: false,
      thresholds,
    });

    expect(dto.messages.map((m) => m.sentAt)).toEqual([
      '2026-10-02T15:00:00.000Z',
      '2026-10-02T15:05:30.123Z',
    ]);
  });

  describe('votación', () => {
    const approver = UserEntity.create({
      name: 'Zelev07',
      username: 'zelev',
      telegramId: 7,
      isMember: true,
    });
    const rejecter = UserEntity.create({
      name: 'Sombra',
      telegramId: 8,
      isMember: true,
    });
    // Ninguno escribió en el chat: su nombre solo podría salir de la votación.
    const nala = UserEntity.create({
      name: 'Nala',
      telegramId: 9,
      isMember: true,
    });
    const voted = RequestChatEntity.create(
      {
        ...requestChat.props,
        state: RequestChatState.InProgress(),
        votes: Votes.of([
          { voter: approver, type: 'approve' },
          { voter: rejecter, type: 'reject' },
          { voter: nala, type: 'approve' },
        ]),
      },
      requestChat.id,
    );
    const view: RequestChatView = {
      requestChat: voted,
      messages: [first, hello],
      hasOlder: false,
      thresholds,
    };
    const voterNames = [approver.name, rejecter.name, nala.name];
    const voterIds = [approver, rejecter, nala].map((u) => u.id.value);

    it('un miembro ve quién votó cada opción, los conteos, los umbrales y su voto', () => {
      const dto = RequestChatMapper.toMemberDto(view, nala);

      expect(dto.votes).toEqual({ approved: 2, rejected: 1 });
      expect(dto.voters).toEqual({
        approve: [
          { uuid: approver.id.value, name: 'Zelev07', username: 'zelev' },
          { uuid: nala.id.value, name: 'Nala' },
        ],
        reject: [{ uuid: rejecter.id.value, name: 'Sombra' }],
      });
      expect(dto.thresholds).toEqual({ approve: 5, reject: 5 });
      expect(dto.userVote).toBe('approve');
      // Sin `viewer` (eventos para todos), sin voto propio.
      expect(RequestChatMapper.toMemberDto(view).userVote).toBeUndefined();
    });

    it('la respuesta del voto y el evento llevan la votación con nombres', () => {
      const result: VoteResult = {
        requestChatId: voted.id,
        state: 'InProgress',
        votes: voted.votes,
        thresholds,
        userVote: 'approve',
      };

      const event = RequestChatMapper.toVotesEvent(result);
      expect(event).toEqual({
        uuid: voted.id.value,
        state: 'InProgress',
        votes: { approved: 2, rejected: 1 },
        voters: expect.objectContaining({
          reject: [{ uuid: rejecter.id.value, name: 'Sombra' }],
        }) as unknown,
        thresholds,
      });
      expect(RequestChatMapper.toVoteDto(result)).toEqual({
        ...event,
        userVote: 'approve',
      });
    });

    it('la salida para el solicitante, serializada, no contiene votos ni votantes (criterio 10)', () => {
      const raw = JSON.stringify(RequestChatMapper.toRequesterDto(view));

      for (const key of ['votes', 'voters', 'userVote', 'thresholds']) {
        expect(raw).not.toContain(`"${key}"`);
      }
      for (const leaked of [...voterNames, ...voterIds]) {
        expect(raw).not.toContain(leaked);
      }
      // Lo suyo sí: el chat con sus mensajes.
      expect(raw).toContain('hola, Ana');
    });
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
