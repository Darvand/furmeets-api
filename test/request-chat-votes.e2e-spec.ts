import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { MembershipService } from '../src/membership/application/membership.service';
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
const APPLICANT_C = { id: 9302, first_name: 'Caro' };
const APPLICANT_D = { id: 9303, first_name: 'Dani' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

interface RequestChatDto {
  uuid: string;
  state: string;
  votes: { approved: number; rejected: number };
  thresholds: { approve: number; reject: number };
  userVote?: string;
  messages: { content: string }[];
}

/** Lo que es de la votación: nada de esto llega al solicitante (RNF-PRI-03). */
const VOTING_KEYS = ['votes', 'userVote', 'thresholds'];

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
    await authenticate(applicant);
    return (
      await request(server)
        .post('/applications')
        .set('Authorization', tmaAuth(applicant))
        .send({ age: 25, city: 'Bogotá' })
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

  const getRequestChat = (user: TelegramInitDataUser, id: string) =>
    request(server)
      .get(`/request-chats/${id}`)
      .set('Authorization', tmaAuth(user))
      .expect(200)
      .then((res) => res.body as RequestChatDto);

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
    // Los avisos van en segundo plano.
    await testApp.app.get(BackgroundQueue).drain();
    const chat = (
      await request(server)
        .get(`/request-chats/${requestChat.uuid}`)
        .set('Authorization', tmaAuth(MEMBERS[0]))
        .expect(200)
    ).body as RequestChatDto;
    expect(chat.state).toBe('Approved');
    // El chat no recibe mensaje de cierre: el resultado lo muestra la App.
    expect(chat.messages).toEqual([]);
    const announcements = tg.sendMessageToGroup.mock.calls.filter(
      ([text]: [string]) => text.includes('ha sido aprobada'),
    );
    expect(announcements).toHaveLength(1);
    expect(tg.sendInviteLinkToUser).toHaveBeenCalledTimes(1);
  });

  it('un miembro ve conteos, umbrales y su propio voto, nunca quién votó; el solicitante, nada de eso', async () => {
    const created = await createRequestChat(APPLICANT_C);
    // La respuesta de enviar el formulario ya va sin votación.
    for (const key of VOTING_KEYS) {
      expect(created).not.toHaveProperty(key);
    }
    await vote(MEMBERS[0], created, 'approve');
    await vote(MEMBERS[1], created, 'reject');
    await vote(MEMBERS[2], created, 'approve');

    const seen = await getRequestChat(MEMBERS[1], created.uuid);
    expect(seen.votes).toEqual({ approved: 2, rejected: 1 });
    // Anónimo (RNF-PRI-01): en el chat no escribió nadie, así que ningún miembro aparece.
    const seenRaw = JSON.stringify(seen);
    for (const name of ['Miembro 1', 'Miembro 2', 'Miembro 3']) {
      expect(seenRaw).not.toContain(name);
    }
    expect(seen.thresholds).toEqual({ approve: 5, reject: 5 });
    expect(seen.userVote).toBe('reject');
    expect((await getRequestChat(MEMBERS[7], created.uuid)).userVote).toBe(
      undefined,
    );

    const own = await getRequestChat(APPLICANT_C, created.uuid);
    expect(own.uuid).toBe(created.uuid);
    const raw = JSON.stringify(own);
    for (const key of VOTING_KEYS) {
      expect(raw).not.toContain(`"${key}"`);
    }
    for (const name of ['Miembro 1', 'Miembro 2', 'Miembro 3']) {
      expect(raw).not.toContain(name);
    }
  });

  it('nadie vota su propia solicitud, aunque ya sea miembro (403)', async () => {
    const created = await createRequestChat(APPLICANT_D);
    // Entra al grupo por otra vía con la solicitud aún en curso.
    MEMBER_IDS.add(APPLICANT_D.id);
    testApp.app.get(MembershipService).invalidate(APPLICANT_D.id);

    await vote(APPLICANT_D, created, 'approve').expect(403);

    expect(await storedVotes(created)).toEqual([]);
    // Ya miembro, ve la votación de su solicitud (SPEC §3.3: no se oculta al ingresar).
    expect((await getRequestChat(APPLICANT_D, created.uuid)).votes).toEqual({
      approved: 0,
      rejected: 0,
    });
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
