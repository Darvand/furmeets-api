import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { BackgroundQueue } from '../src/shared/async/background-queue';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBERS = Array.from({ length: 8 }, (_, i) => ({
  id: 9201 + i,
  first_name: `Miembro ${i + 1}`,
}));
const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));
const APPLICANT_A = { id: 9300, first_name: 'Ana' };
const APPLICANT_B = { id: 9301, first_name: 'Beto' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

interface RequestChatDto {
  uuid: string;
  state: string;
  votes: { approved: number; rejected: number };
  messages: { content: string }[];
}

describe('Votos atómicos y lecturas sin efectos (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let db: Connection;
  let requestChatA: RequestChatDto;

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  const createRequestChat = async (applicant: TelegramInitDataUser) => {
    const entity = await authenticate(applicant);
    return (
      await request(server)
        .post('/request-chats')
        .set('Authorization', tmaAuth(applicant))
        .send({ requesterUUID: entity.id.value })
        .expect(201)
    ).body as RequestChatDto;
  };

  const vote = (
    member: TelegramInitDataUser,
    requestChat: RequestChatDto,
    type: 'approve' | 'reject',
  ) =>
    request(server)
      .put(`/request-chats/${requestChat.uuid}/vote/${type}`)
      .set('Authorization', tmaAuth(member));

  /** Votos tal como quedaron en la BD. */
  const storedVotes = async (requestChat: RequestChatDto) => {
    const doc = await db
      .collection<{
        _id: mongo.UUID;
        votes: { type: string }[];
      }>('requestchats')
      .findOne({ _id: new mongo.UUID(requestChat.uuid) });
    return doc!.votes;
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: MEMBER_IDS.has(id) ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    server = testApp.app.getHttpServer() as App;
    db = testApp.app.get<Connection>(getConnectionToken());
    await Promise.all(MEMBERS.map(authenticate));
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('votos concurrentes de miembros distintos quedan todos guardados', async () => {
    const requestChat = await createRequestChat(APPLICANT_A);
    requestChatA = requestChat;
    const voters = MEMBERS.slice(0, 4);

    const responses = await Promise.all(
      voters.map((member) => vote(member, requestChat, 'approve')),
    );

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const votes = await storedVotes(requestChat);
    expect(votes).toHaveLength(4);
    const chat = (
      await request(server)
        .get(`/request-chats/${requestChat.uuid}`)
        .set('Authorization', tmaAuth(MEMBERS[0]))
        .expect(200)
    ).body as RequestChatDto;
    expect(chat.votes).toEqual({ approved: 4, rejected: 0 });
    expect(chat.state).toBe('InProgress');
  });

  it('el mismo miembro votando dos veces a la vez nunca deja dos votos suyos', async () => {
    const member = MEMBERS[5];

    await Promise.all([
      vote(member, requestChatA, 'reject'),
      vote(member, requestChatA, 'reject'),
    ]);

    const votes = await storedVotes(requestChatA);
    expect(votes.filter((v) => v.type === 'reject').length).toBeLessThanOrEqual(
      1,
    );
  });

  it('si varios votos cruzan el umbral a la vez, se cierra una sola vez', async () => {
    const requestChat = await createRequestChat(APPLICANT_B);
    const tg = testApp.telegramBot;
    tg.sendMessageToGroup.mockClear();
    tg.sendInviteLinkToUser.mockClear();

    const responses = await Promise.all(
      MEMBERS.map((member) => vote(member, requestChat, 'approve')),
    );

    // Los que llegan después del cierre reciben 409; ninguno falla de otra forma.
    expect(responses.every((r) => r.status === 200 || r.status === 409)).toBe(
      true,
    );
    // El mensaje de cierre y los avisos van en segundo plano.
    await testApp.app.get(BackgroundQueue).drain();
    const chat = (
      await request(server)
        .get(`/request-chats/${requestChat.uuid}`)
        .set('Authorization', tmaAuth(MEMBERS[0]))
        .expect(200)
    ).body as RequestChatDto;
    expect(chat.state).toBe('Approved');
    const closing = chat.messages.filter((m) => m.content.includes('aprobada'));
    expect(closing).toHaveLength(1);
    const announcements = tg.sendMessageToGroup.mock.calls.filter(
      ([text]: [string]) => text.includes('ha sido aprobada'),
    );
    expect(announcements).toHaveLength(1);
    expect(tg.sendInviteLinkToUser).toHaveBeenCalledTimes(1);
  });

  it('un GET no modifica la BD', async () => {
    const snapshot = async () =>
      JSON.stringify([
        await db.collection('requestchats').find().sort({ _id: 1 }).toArray(),
        await db
          .collection('requestchatmessages')
          .find()
          .sort({ _id: 1 })
          .toArray(),
      ]);
    const list = (
      await request(server)
        .get('/request-chats')
        .set('Authorization', tmaAuth(MEMBERS[7]))
        .expect(200)
    ).body as { items: RequestChatDto[] };
    const before = await snapshot();

    for (const item of list.items) {
      await request(server)
        .get(`/request-chats/${item.uuid}`)
        .set('Authorization', tmaAuth(MEMBERS[7]))
        .expect(200);
    }
    await request(server)
      .get('/request-chats')
      .set('Authorization', tmaAuth(MEMBERS[7]))
      .expect(200);

    expect(await snapshot()).toBe(before);
  });
});
