import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
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

const MEMBERS = Array.from({ length: 5 }, (_, i) => ({
  id: 9701 + i,
  first_name: `Miembro ${i + 1}`,
}));
const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));
const [MEMBER, OTHER_MEMBER] = MEMBERS;
const APPLICANT = { id: 9800, first_name: 'Ana' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };
/** Para comprobar que un evento no llega. */
const SETTLE_MS = 300;

interface MessageEvent {
  uuid: string;
  requestChatUUID: string;
  clientMessageId?: string;
  content: string;
}

interface VotesEvent {
  uuid: string;
  state: string;
  votes: { approved: number; rejected: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Eventos en vivo para la App (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let requestChatId: string;
  const sockets: Socket[] = [];

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

  const vote = (member: TelegramInitDataUser, type: 'approve' | 'reject') =>
    request(server)
      .put(`/request-chats/${requestChatId}/vote/${type}`)
      .set('Authorization', tmaAuth(member))
      .expect(200);

  /** Todo lo que recibe `socket` de `event`. */
  const inbox = <T>(socket: Socket, event: string): T[] => {
    const received: T[] = [];
    socket.on(event, (payload: T) => received.push(payload));
    return received;
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

    const auth = testApp.app.get(InitDataAuthService);
    await auth.authenticate(signInitData(APPLICANT, TEST_BOT_TOKEN));
    await Promise.all(
      MEMBERS.map((m) => auth.authenticate(signInitData(m, TEST_BOT_TOKEN))),
    );
    requestChatId = (
      (
        await request(server)
          .post('/applications')
          .set('Authorization', tmaAuth(APPLICANT))
          .send({ age: 25, city: 'Bogotá' })
          .expect(201)
      ).body as { uuid: string }
    ).uuid;
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await testApp.app.get(BackgroundQueue).drain();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('el mensaje trae su solicitud y el clientMessageId, en el ack y en el evento', async () => {
    const ana = await connect(APPLICANT);
    const member = await connect(MEMBER);
    const received = new Promise<MessageEvent>((resolve) =>
      member.once('request-chat', resolve),
    );
    const clientMessageId = randomUUID();

    const ack = (await ana.emitWithAck('request-chat', {
      requestChatUUID: requestChatId,
      clientMessageId,
      content: 'hola',
    })) as MessageEvent;

    expect(ack).toMatchObject({
      requestChatUUID: requestChatId,
      clientMessageId,
    });
    expect(await received).toMatchObject({
      uuid: ack.uuid,
      requestChatUUID: requestChatId,
      clientMessageId,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['un clientMessageId que no es UUID', { clientMessageId: 'no-es-uuid' }],
    ['un contenido vacío', { content: '' }],
    ['un campo de más', { extra: true }],
  ])(
    '%s se rechaza sin guardar, con el payload en la causa',
    async (_, overrides) => {
      const ana = await connect(APPLICANT);
      const member = await connect(MEMBER);
      const received = inbox<MessageEvent>(member, 'request-chat');
      const rejected = new Promise<{
        message: string;
        cause?: { data?: { clientMessageId?: string } };
      }>((resolve) => ana.once('exception', resolve));
      const clientMessageId = randomUUID();

      ana.emit('request-chat', {
        requestChatUUID: requestChatId,
        clientMessageId,
        content: 'hola',
        ...overrides,
      });

      const exception = await rejected;
      expect(exception.message).toBe('invalid-payload');
      // La App correlaciona el fallo con su mensaje optimista por la causa.
      expect(exception.cause?.data?.clientMessageId).toBe(
        overrides.clientMessageId ?? clientMessageId,
      );
      await sleep(SETTLE_MS);
      expect(received).toHaveLength(0);
    },
  );

  it('cada voto llega en vivo a los miembros con conteos, sin votos de nadie; el solicitante no lo recibe', async () => {
    const member = await connect(OTHER_MEMBER);
    const ana = await connect(APPLICANT);
    const memberVotes = inbox<VotesEvent>(member, 'request-chat-votes');
    const anaVotes = inbox<VotesEvent>(ana, 'request-chat-votes');

    await vote(MEMBER, 'reject');
    await sleep(SETTLE_MS);

    expect(memberVotes).toEqual([
      {
        uuid: requestChatId,
        state: 'InProgress',
        votes: { approved: 0, rejected: 1 },
      },
    ]);
    expect(anaVotes).toHaveLength(0);
  });

  it('request-chat-update no lleva el voto de quien cerró', async () => {
    const ana = await connect(APPLICANT);
    const member = await connect(OTHER_MEMBER);
    const updated = new Promise<Record<string, unknown>>((resolve) =>
      member.once('request-chat-update', resolve),
    );
    const anaUpdated = new Promise<Record<string, unknown>>((resolve) =>
      ana.once('request-chat-update', resolve),
    );

    // Con el rechazo de la prueba anterior, dos más llegan al umbral de 3.
    for (const m of MEMBERS.slice(1, 3)) {
      await vote(m, 'reject');
    }

    const update = await updated;
    expect(update).toMatchObject({ uuid: requestChatId, state: 'Rejected' });
    expect(update).not.toHaveProperty('userVote');
    expect(await anaUpdated).toMatchObject({ state: 'Rejected' });
  });
});
