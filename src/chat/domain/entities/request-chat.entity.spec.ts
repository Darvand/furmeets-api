import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatEntity } from './request-chat.entity';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatEntity', () => {
  const requester = user(1);
  let requestChat: RequestChatEntity;

  beforeEach(() => {
    requestChat = RequestChatEntity.asNew(requester, 'furros', 'Instagram');
  });

  it('una solicitud nueva queda en curso y sin votos', () => {
    expect(requestChat.isInProgress()).toBe(true);
    expect(requestChat.state).toBe('InProgress');
    expect(requestChat.countApproves()).toBe(0);
    expect(requestChat.countRejects()).toBe(0);
  });

  it('los mensajes de sistema son del bot y de esta solicitud', () => {
    const bot = user(999);
    const at = new Date('2026-10-02T15:00:00.000Z');

    const welcome = requestChat.welcomeMessage(bot, at);

    expect(welcome.requestChatId.equals(requestChat.id)).toBe(true);
    expect(welcome.author).toBe(bot);
    expect(welcome.createdAt).toBe(at);
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

  it('el aviso de mensaje nuevo nombra al solicitante', () => {
    expect(RequestChatEntity.newMessageNotificationText(requester)).toContain(
      'User 1, tienes un mensaje nuevo',
    );
  });
});
