import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatEntity } from './request-chat.entity';
import { RequestChatVoteEntity } from './request-chat-vote.entity';

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

  it('los mensajes de sistema son del bot, de esta solicitud y nacen sin leer', () => {
    const bot = user(999);
    const at = new Date('2026-10-02T15:00:00.000Z');

    const welcome = requestChat.welcomeMessage(bot, at);

    expect(welcome.requestChatId.equals(requestChat.id)).toBe(true);
    expect(welcome.author).toBe(bot);
    expect(welcome.createdAt).toBe(at);
    expect(welcome.isReadBy(requester)).toBe(false);
    expect(welcome.isReadBy(bot)).toBe(false);
  });

  describe('addVote', () => {
    it('registra el voto de un miembro', () => {
      const member = user(2);
      requestChat.addVote(RequestChatVoteEntity.asApprove(member));

      expect(requestChat.countApproves()).toBe(1);
      expect(requestChat.getUserVoteType(member)).toBe('approve');
    });

    it('repetir el mismo voto lo retira', () => {
      const member = user(2);
      requestChat.addVote(RequestChatVoteEntity.asApprove(member));
      requestChat.addVote(RequestChatVoteEntity.asApprove(member));

      expect(requestChat.countApproves()).toBe(0);
      expect(requestChat.getUserVoteType(member)).toBeUndefined();
    });

    it('un voto distinto del mismo miembro reemplaza al anterior', () => {
      const member = user(2);
      requestChat.addVote(RequestChatVoteEntity.asApprove(member));
      requestChat.addVote(RequestChatVoteEntity.asReject(member));

      expect(requestChat.countApproves()).toBe(0);
      expect(requestChat.countRejects()).toBe(1);
      expect(requestChat.getUserVoteType(member)).toBe('reject');
    });

    it('se aprueba al llegar a 5 aprobaciones', () => {
      for (let id = 2; id <= 5; id++) {
        requestChat.addVote(RequestChatVoteEntity.asApprove(user(id)));
      }
      expect(requestChat.isInProgress()).toBe(true);

      requestChat.addVote(RequestChatVoteEntity.asApprove(user(6)));

      expect(requestChat.isApproved()).toBe(true);
    });

    it('se rechaza al llegar a 3 rechazos', () => {
      for (let id = 2; id <= 4; id++) {
        requestChat.addVote(RequestChatVoteEntity.asReject(user(id)));
      }

      expect(requestChat.isRejected()).toBe(true);
    });
  });
});
