import { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  RequestChatClosedError,
  RequestChatEntity,
} from './request-chat.entity';
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

  it('una solicitud nueva queda en curso y sin votos', () => {
    expect(requestChat.isInProgress()).toBe(true);
    expect(requestChat.state).toBe('InProgress');
    expect(requestChat.countApproves()).toBe(0);
    expect(requestChat.countRejects()).toBe(0);
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

  describe('outcomeFor', () => {
    it('sin umbral alcanzado no hay resultado', () => {
      expect(
        RequestChatEntity.outcomeFor({ approved: 4, rejected: 1 }),
      ).toBeUndefined();
    });

    it('5 aprobaciones → aprobada', () => {
      expect(
        RequestChatEntity.outcomeFor({
          approved: 5,
          rejected: 0,
        })?.isApproved(),
      ).toBe(true);
    });

    it('3 rechazos → rechazada', () => {
      expect(
        RequestChatEntity.outcomeFor({
          approved: 0,
          rejected: 3,
        })?.isRejected(),
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
        votes: [],
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

  describe('requesterMessageNotice', () => {
    it('lleva al solicitante, el contenido y el enlace a la solicitud', () => {
      const text = RequestChatEntity.requesterMessageNotice(
        requestChat.id,
        requester,
        'hola, soy nuevo',
      );

      expect(text).toContain('*User 1*');
      expect(text).toContain('hola, soy nuevo');
      expect(text).toContain(`?startapp=${requestChat.id.value})`);
    });

    it('escapa el Markdown del usuario para que Telegram no rechace el aviso', () => {
      const text = RequestChatEntity.requesterMessageNotice(
        requestChat.id,
        user(3),
        'me_gusta *mucho* [esto] `ya`',
      );

      expect(text).toContain('me\\_gusta \\*mucho\\* \\[esto] \\`ya\\`');
    });

    it('recorta un contenido muy largo', () => {
      const text = RequestChatEntity.requesterMessageNotice(
        requestChat.id,
        requester,
        'a'.repeat(5_000),
      );

      expect(text.length).toBeLessThan(4_096);
      expect(text).toContain('a…');
    });
  });

  it('el aviso de mensaje nuevo nombra al solicitante', () => {
    expect(RequestChatEntity.newMessageNotificationText(requester)).toContain(
      'User 1, tienes un mensaje nuevo',
    );
  });
});
