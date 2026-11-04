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
    // Ninguno escribió en el chat: si su nombre o su id salen, es por la votación.
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
          { voterId: approver.id, type: 'approve' },
          { voterId: rejecter.id, type: 'reject' },
          { voterId: nala.id, type: 'approve' },
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

    /** Nada en `raw` permite saber quién votó. */
    const expectAnonymous = (raw: string) => {
      expect(raw).not.toContain('"voters"');
      for (const leaked of [...voterNames, ...voterIds]) {
        expect(raw).not.toContain(leaked);
      }
    };

    it('un miembro ve los conteos, los umbrales y su propio voto, pero no quién votó', () => {
      const dto = RequestChatMapper.toMemberDto(view, nala);

      expect(dto.votes).toEqual({ approved: 2, rejected: 1 });
      expect(dto.thresholds).toEqual({ approve: 5, reject: 5 });
      expect(dto.userVote).toBe('approve');
      expectAnonymous(JSON.stringify(dto));
      // Sin `viewer` (eventos para todos), sin voto propio.
      expect(RequestChatMapper.toMemberDto(view).userVote).toBeUndefined();
    });

    it('la respuesta del voto y el evento llevan solo conteos y umbrales', () => {
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
        thresholds,
      });
      expect(RequestChatMapper.toVoteDto(result)).toEqual({
        ...event,
        userVote: 'approve',
      });
      expectAnonymous(JSON.stringify(RequestChatMapper.toVoteDto(result)));
    });

    it('la salida para el solicitante, serializada, no contiene votos (criterio 10)', () => {
      const raw = JSON.stringify(RequestChatMapper.toRequesterDto(view));

      for (const key of ['votes', 'userVote', 'thresholds']) {
        expect(raw).not.toContain(`"${key}"`);
      }
      expectAnonymous(raw);
      // Lo suyo sí: el chat con sus mensajes.
      expect(raw).toContain('hola, Ana');
    });
  });

  describe('avales', () => {
    // No escribió en el chat: si su nombre o su id salen, es por el aval.
    const kira = UserEntity.create({
      name: 'Kira',
      username: 'kira',
      telegramId: 10,
      isMember: true,
    });
    const endorsed = RequestChatEntity.create(
      {
        ...requestChat.props,
        endorsements: [
          { endorser: kira, at: new Date('2026-10-05T12:00:00.000Z') },
        ],
      },
      requestChat.id,
    );
    const view: RequestChatView = {
      requestChat: endorsed,
      messages: [first, hello],
      hasOlder: false,
      thresholds,
    };

    it('un miembro ve cada aval con quién avaló y cuándo (ISO UTC)', () => {
      expect(RequestChatMapper.toMemberDto(view).endorsements).toEqual([
        {
          endorser: { uuid: kira.id.value, name: 'Kira', username: 'kira' },
          at: '2026-10-05T12:00:00.000Z',
        },
      ]);
    });

    it('la respuesta y el evento de un aval llevan todos los avales', () => {
      expect(
        RequestChatMapper.toEndorsementsDto({
          requestChatId: endorsed.id,
          endorsements: [...endorsed.endorsements],
        }),
      ).toEqual({
        uuid: endorsed.id.value,
        endorsements: [
          expect.objectContaining({
            endorser: expect.objectContaining({ name: 'Kira' }) as unknown,
          }),
        ],
      });
    });

    it('la salida para el solicitante, serializada, no contiene avales (criterio 10)', () => {
      const raw = JSON.stringify(RequestChatMapper.toRequesterDto(view));

      expect(raw).not.toContain('"endorsements"');
      expect(raw).not.toContain('Kira');
      expect(raw).not.toContain(kira.id.value);
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
