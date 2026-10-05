import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
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

const MEMBERS = Array.from({ length: 5 }, (_, i) => ({
  id: 9901 + i,
  first_name: `Avalista ${i + 1}`,
}));
const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));
const [KIRA, LUNA] = MEMBERS;
const APPLICANT = { id: 9950, first_name: 'Ana' };
const APPLICANT_OWN = { id: 9951, first_name: 'Beto' };
const APPLICANT_CLOSED = { id: 9952, first_name: 'Caro' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Para comprobar que un evento no llega. */
const SETTLE_MS = 300;

interface EndorsementsDto {
  uuid: string;
  endorsements: { endorser: { uuid: string; name: string }; at: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const names = (dto: EndorsementsDto) =>
  dto.endorsements.map((e) => e.endorser.name);

describe('Avales (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let requestChatId: string;
  const sockets: Socket[] = [];

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  const createRequestChat = async (applicant: TelegramInitDataUser) => {
    await authenticate(applicant);
    return (
      (
        await request(server)
          .post('/applications')
          .set('Authorization', tmaAuth(applicant))
          .send({ age: 25, city: 'Bogotá' })
          .expect(201)
      ).body as { uuid: string }
    ).uuid;
  };

  const endorse = (user: TelegramInitDataUser, id = requestChatId) =>
    request(server)
      .put(`/request-chats/${id}/endorsement`)
      .set('Authorization', tmaAuth(user));

  const withdraw = (user: TelegramInitDataUser, id = requestChatId) =>
    request(server)
      .delete(`/request-chats/${id}/endorsement`)
      .set('Authorization', tmaAuth(user));

  const getRequestChat = async (user: TelegramInitDataUser, id: string) =>
    (
      await request(server)
        .get(`/request-chats/${id}`)
        .set('Authorization', tmaAuth(user))
        .expect(200)
    ).body as Record<string, unknown>;

  const connect = async (user: TelegramInitDataUser): Promise<Socket> => {
    const socket = io(url, {
      auth: { initData: signInitData(user, TEST_BOT_TOKEN) },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: MEMBER_IDS.has(id) ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    await testApp.app.listen(0);
    server = testApp.app.getHttpServer() as App;
    const { port } = (server as unknown as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    await Promise.all(MEMBERS.map(authenticate));
    requestChatId = await createRequestChat(APPLICANT);
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await testApp.app.get(BackgroundQueue).drain();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('un miembro avala: la respuesta trae quién avaló y cuándo', async () => {
    const res = await endorse(KIRA).expect(200);
    const body = res.body as EndorsementsDto;

    expect(body.uuid).toBe(requestChatId);
    expect(names(body)).toEqual(['Avalista 1']);
    expect(body.endorsements[0].at).toMatch(ISO_UTC);
  });

  it('avalar dos veces, también a la vez, no duplica', async () => {
    await endorse(KIRA).expect(200);
    await Promise.all([endorse(LUNA), endorse(LUNA)]);

    const body = (await endorse(LUNA).expect(200)).body as EndorsementsDto;
    expect(names(body)).toEqual(['Avalista 1', 'Avalista 2']);
  });

  it('el aval llega en vivo a los miembros, no al solicitante', async () => {
    const member = await connect(MEMBERS[2]);
    const ana = await connect(APPLICANT);
    const received = new Promise<EndorsementsDto>((resolve) =>
      member.once('request-chat-endorsements', resolve),
    );
    const anaReceived: unknown[] = [];
    ana.on('request-chat-endorsements', (e) => anaReceived.push(e));

    await endorse(MEMBERS[2]).expect(200);

    expect(names(await received)).toEqual([
      'Avalista 1',
      'Avalista 2',
      'Avalista 3',
    ]);
    await sleep(SETTLE_MS);
    expect(anaReceived).toHaveLength(0);
  });

  it('retirar el aval lo quita; retirarlo otra vez no cambia nada', async () => {
    const body = (await withdraw(MEMBERS[2]).expect(200))
      .body as EndorsementsDto;
    expect(names(body)).toEqual(['Avalista 1', 'Avalista 2']);

    const again = (await withdraw(MEMBERS[2]).expect(200))
      .body as EndorsementsDto;
    expect(names(again)).toEqual(['Avalista 1', 'Avalista 2']);
  });

  it('un miembro ve los avales con autor y fecha; el solicitante no ve ninguno (criterios 9 y 10)', async () => {
    const seen = await getRequestChat(MEMBERS[4], requestChatId);
    const endorsements = seen.endorsements as EndorsementsDto['endorsements'];
    expect(endorsements.map((e) => e.endorser.name)).toEqual([
      'Avalista 1',
      'Avalista 2',
    ]);
    expect(endorsements[0].at).toMatch(ISO_UTC);

    const own = await getRequestChat(APPLICANT, requestChatId);
    const raw = JSON.stringify(own);
    expect(raw).not.toContain('"endorsements"');
    for (const m of MEMBERS) {
      expect(raw).not.toContain(m.first_name);
    }
  });

  it.each([
    ['avala', endorse],
    ['retira un aval', withdraw],
  ])('el solicitante %s → 403', async (_, act) => {
    await act(APPLICANT).expect(403);
  });

  it('un id que no es UUID → 400; una solicitud que no existe → 404', async () => {
    await endorse(KIRA, 'no-es-uuid').expect(400);
    await endorse(KIRA, randomUUID()).expect(404);
  });

  it('nadie avala su propia solicitud, aunque ya sea miembro (403)', async () => {
    const id = await createRequestChat(APPLICANT_OWN);
    MEMBER_IDS.add(APPLICANT_OWN.id);
    testApp.app.get(MembershipService).invalidate(APPLICANT_OWN.id);

    await endorse(APPLICANT_OWN, id).expect(403);
    expect(await getRequestChat(APPLICANT_OWN, id)).toMatchObject({
      endorsements: [],
    });
  });

  it('cerrada la solicitud, no se avala ni se retira (409); el cierre no le lleva avales al solicitante', async () => {
    const id = await createRequestChat(APPLICANT_CLOSED);
    await endorse(KIRA, id).expect(200);
    const caro = await connect(APPLICANT_CLOSED);
    const updated = new Promise<Record<string, unknown>>((resolve) =>
      caro.once('request-chat-update', resolve),
    );

    for (const m of MEMBERS) {
      await request(server)
        .put(`/request-chats/${id}/vote/approve`)
        .set('Authorization', tmaAuth(m))
        .expect(200);
    }

    const update = await updated;
    expect(update).toMatchObject({ state: 'Approved' });
    expect(JSON.stringify(update)).not.toContain('Avalista');
    await endorse(LUNA, id).expect(409);
    await withdraw(KIRA, id).expect(409);
    // El aval que había queda como estaba.
    expect(
      (await getRequestChat(LUNA, id)).endorsements as unknown[],
    ).toHaveLength(1);
  });
});
