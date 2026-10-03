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

  it('los mensajes de sistema son del bot y de esta solicitud', () => {
    const bot = user(999);
    const at = new Date('2026-10-02T15:00:00.000Z');

    const welcome = requestChat.welcomeMessage(bot, at);

    expect(welcome.requestChatId.equals(requestChat.id)).toBe(true);
    expect(welcome.author).toBe(bot);
    expect(welcome.createdAt).toBe(at);
  });

  describe('addVote', () => {
    it('registra el voto de un miembro y lo informa como "set"', () => {
      const member = user(2);
      const vote = RequestChatVoteEntity.asApprove(member);

      expect(requestChat.addVote(vote)).toEqual({ kind: 'set', vote });
      expect(requestChat.countApproves()).toBe(1);
      expect(requestChat.getUserVoteType(member)).toBe('approve');
    });

    it('repetir el mismo voto lo retira y lo informa como "removed"', () => {
      const member = user(2);
      requestChat.addVote(RequestChatVoteEntity.asApprove(member));

      expect(
        requestChat.addVote(RequestChatVoteEntity.asApprove(member)),
      ).toEqual({ kind: 'removed', userId: member.id.value });
      expect(requestChat.countApproves()).toBe(0);
      expect(requestChat.getUserVoteType(member)).toBeUndefined();
    });

    it('un voto distinto del mismo miembro reemplaza al anterior', () => {
      const member = user(2);
      requestChat.addVote(RequestChatVoteEntity.asApprove(member));
      const change = requestChat.addVote(
        RequestChatVoteEntity.asReject(member),
      );

      expect(change.kind).toBe('set');
      expect(requestChat.countApproves()).toBe(0);
      expect(requestChat.countRejects()).toBe(1);
      expect(requestChat.getUserVoteType(member)).toBe('reject');
    });

    it('votar no cambia el estado: lo decide outcome()', () => {
      for (let id = 2; id <= 6; id++) {
        requestChat.addVote(RequestChatVoteEntity.asApprove(user(id)));
      }

      expect(requestChat.isInProgress()).toBe(true);
      expect(requestChat.outcome()?.isApproved()).toBe(true);
    });
  });

  describe('outcome', () => {
    it('sin umbral alcanzado no hay resultado', () => {
      for (let id = 2; id <= 5; id++) {
        requestChat.addVote(RequestChatVoteEntity.asApprove(user(id)));
      }
      requestChat.addVote(RequestChatVoteEntity.asReject(user(10)));

      expect(requestChat.outcome()).toBeUndefined();
    });

    it('5 aprobaciones → aprobada', () => {
      for (let id = 2; id <= 6; id++) {
        requestChat.addVote(RequestChatVoteEntity.asApprove(user(id)));
      }

      expect(requestChat.outcome()?.isApproved()).toBe(true);
    });

    it('3 rechazos → rechazada', () => {
      for (let id = 2; id <= 4; id++) {
        requestChat.addVote(RequestChatVoteEntity.asReject(user(id)));
      }

      expect(requestChat.outcome()?.isRejected()).toBe(true);
    });

    it('una solicitud ya cerrada no tiene otro resultado', () => {
      for (let id = 2; id <= 4; id++) {
        requestChat.addVote(RequestChatVoteEntity.asReject(user(id)));
      }
      requestChat.close(requestChat.outcome()!);

      expect(requestChat.isRejected()).toBe(true);
      expect(requestChat.outcome()).toBeUndefined();
    });
  });
});
