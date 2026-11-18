import { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  CannotReviewOwnRequestError,
  RequestChatClosedError,
  RequestChatEntity,
} from './request-chat.entity';
import { Votes, type VoteType } from 'src/review/domain/vote';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { ApplicationForm } from 'src/applications/domain/application-form';
import { DateTime } from 'luxon';
import { RequestChatState } from '../value-objects/request-chat-state.value-object';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatEntity', () => {
  const requester = user(1);
  let requestChat: RequestChatEntity;

  beforeEach(() => {
    requestChat = RequestChatEntity.apply(
      requester,
      ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
    );
  });

  it('una solicitud nueva queda en curso, sin votos ni avales', () => {
    expect(requestChat.isInProgress()).toBe(true);
    expect(requestChat.state).toBe('InProgress');
    expect(requestChat.votes.tally()).toEqual({ approved: 0, rejected: 0 });
    expect(requestChat.endorsements).toEqual([]);
  });

  describe('assertAcceptsMessages', () => {
    it('en curso acepta mensajes', () => {
      expect(() =>
        RequestChatEntity.assertAcceptsMessages(requestChat.id, 'InProgress'),
      ).not.toThrow();
    });

    it.each(['Approved', 'Rejected'] as const)(
      '%s es de solo lectura → RequestChatClosedError',
      (state) => {
        expect(() =>
          RequestChatEntity.assertAcceptsMessages(requestChat.id, state),
        ).toThrow(RequestChatClosedError);
      },
    );
  });

  describe('assertAcceptsReviewFrom', () => {
    const member = user(2);
    const header = (state: 'InProgress' | 'Approved' | 'Rejected') => ({
      id: requestChat.id,
      requesterId: requester.id,
      state,
    });

    it('un miembro vota o avala una solicitud en curso', () => {
      expect(() =>
        RequestChatEntity.assertAcceptsReviewFrom(
          header('InProgress'),
          member.id,
        ),
      ).not.toThrow();
    });

    it('nadie vota ni avala su propia solicitud, aunque ya sea miembro', () => {
      expect(() =>
        RequestChatEntity.assertAcceptsReviewFrom(
          header('InProgress'),
          UUID.from(requester.id.value),
        ),
      ).toThrow(CannotReviewOwnRequestError);
    });

    it.each(['Approved', 'Rejected'] as const)(
      '%s ya no acepta votos ni avales → RequestChatClosedError',
      (state) => {
        expect(() =>
          RequestChatEntity.assertAcceptsReviewFrom(header(state), member.id),
        ).toThrow(RequestChatClosedError);
      },
    );
  });

  describe('outcomeFor', () => {
    const thresholds = { approve: 5, reject: 5 };
    const cast = (approves: number, rejects: number) =>
      Votes.of(
        [
          ...Array<VoteType>(approves).fill('approve'),
          ...Array<VoteType>(rejects).fill('reject'),
        ].map((type) => ({ voterId: UUID.generate(), type })),
      );

    it('sin umbral alcanzado no hay resultado', () => {
      expect(
        RequestChatEntity.outcomeFor(cast(4, 4), thresholds),
      ).toBeUndefined();
    });

    it('5 aprobaciones → aprobada', () => {
      expect(
        RequestChatEntity.outcomeFor(cast(5, 0), thresholds)?.isApproved(),
      ).toBe(true);
    });

    it('5 rechazos → rechazada', () => {
      expect(
        RequestChatEntity.outcomeFor(cast(1, 5), thresholds)?.isRejected(),
      ).toBe(true);
    });
  });

  describe('announceWelcomeMesssage', () => {
    it('del formulario anterior: solo sus líneas, sin las del formulario nuevo', () => {
      // Como las que migró T12: sin `form`, con el bloque `legacy`.
      const text = RequestChatEntity.create({
        requester,
        legacy: { howDidYouFindUs: 'Instagram', interests: 'furros' },
        state: RequestChatState.InProgress(),
        createdAt: DateTime.now(),
        votes: Votes.none(),
        endorsements: [],
      }).announceWelcomeMesssage();

      expect(text).toContain('*¿Cómo conoció FurMeets?* Instagram');
      expect(text).toContain('*¿Cuáles son sus intereses?* furros');
      expect(text).not.toContain('Edad:');
      expect(text).not.toContain('Ciudad:');
    });

    it('del formulario nuevo: solo las líneas con valor, sin etiqueta de menor', () => {
      const text = RequestChatEntity.apply(
        requester,
        ApplicationForm.submit({
          age: 16,
          city: 'Cali',
          species: 'Zorro_rojo',
          fursonaName: '  ',
        }),
      ).announceWelcomeMesssage();

      expect(text).toContain('*Edad:* 16');
      expect(text).toContain('*Especie:* Zorro\\_rojo');
      expect(text).not.toContain('Fursona:');
      expect(text).not.toContain('intereses');
      expect(text).not.toContain('Menor de edad');
      expect(text).not.toMatch(/\n\n/);
    });
  });

  it('los enlaces a la App son https://t.me/<bot>, sin nombre de app', () => {
    const request = RequestChatEntity.apply(
      requester,
      ApplicationForm.submit({ age: 20, city: 'Cali' }),
    );

    expect(request.announceWelcomeMesssage()).toMatch(
      new RegExp(
        `\\[Ver solicitud\\]\\(https://t\\.me/[^/)?]+\\?startapp=${request.id.value}\\)$`,
      ),
    );
    expect(RequestChatEntity.newMessageNotificationText(requester)).toMatch(
      /\[chat\]\(https:\/\/t\.me\/[^/)?]+\)/,
    );
  });

  it('el aviso de mensaje nuevo nombra al solicitante', () => {
    expect(RequestChatEntity.newMessageNotificationText(requester)).toContain(
      'User 1, tienes un mensaje nuevo',
    );
  });

  describe('Markdown en el nombre del solicitante', () => {
    const named = UserEntity.create({
      name: 'Maxy_fur *[x]*',
      telegramId: 9,
      isMember: false,
    });
    const escaped = 'Maxy\\_fur \\*\\[x]\\*';

    it('se escapa en los avisos de aprobación y rechazo', () => {
      const chat = RequestChatEntity.apply(
        named,
        ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
      );

      expect(chat.announceApproval()).toContain(`[${escaped}](tg://user?id=9)`);
      expect(chat.announceRejection()).toContain(
        `[${escaped}](tg://user?id=9)`,
      );
    });

    it('se escapa en el aviso de mensaje nuevo', () => {
      expect(RequestChatEntity.newMessageNotificationText(named)).toContain(
        `${escaped}, tienes un mensaje nuevo`,
      );
    });
  });
});
