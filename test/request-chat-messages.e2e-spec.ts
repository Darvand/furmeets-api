import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBER = { id: 9101, first_name: 'Mia' };
const MEMBER_2 = { id: 9103, first_name: 'Beto' };
const MEMBER_3 = { id: 9104, first_name: 'Caro' };
const MEMBER_IDS = new Set([MEMBER.id, MEMBER_2.id, MEMBER_3.id]);
const APPLICANT = { id: 9102, first_name: 'Ana' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

const CONCURRENT = 20;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface MessageDto {
  uuid: string;
  content: string;
  sentAt: string;
}
interface RequestChatDto {
  uuid: string;
  state: string;
  messages: MessageDto[];
}
interface ListDto {
  items: {
    uuid: string;
    lastMessage?: { content: string; at: string };
  }[];
}

describe('Mensajes en su propia colección (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let db: Connection;
  let requestChat: RequestChatDto;
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

  const getRequestChat = async (user: TelegramInitDataUser) =>
    (
      await request(server)
        .get(`/request-chats/${requestChat.uuid}`)
        .set('Authorization', tmaAuth(user))
        .expect(200)
    ).body as RequestChatDto;

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
    db = testApp.app.get<Connection>(getConnectionToken());

    const ana = await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(APPLICANT, TEST_BOT_TOKEN));
    requestChat = (
      await request(server)
        .post('/request-chats')
        .set('Authorization', tmaAuth(APPLICANT))
        .send({ requesterUUID: ana.id.value, interests: 'furros' })
        .expect(201)
    ).body as RequestChatDto;
  });

  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await testApp?.close();
  });

  it('la solicitud nace con el mensaje de bienvenida en la colección de mensajes', async () => {
    expect(requestChat.messages).toHaveLength(1);

    const stored = await db.collection('requestchatmessages').countDocuments();
    expect(stored).toBe(1);
  });

  it(`${CONCURRENT} mensajes concurrentes quedan los ${CONCURRENT} persistidos, en orden y con su createdAt`, async () => {
    const [ana, mia] = await Promise.all([connect(APPLICANT), connect(MEMBER)]);
    let delivered = 0;
    const allDelivered = new Promise<void>((resolve) =>
      mia.on('request-chat', () => {
        if (++delivered === CONCURRENT) resolve();
      }),
    );

    // Los dos escriben a la vez: la mitad cada uno, sin esperar respuesta.
    for (let i = 0; i < CONCURRENT; i++) {
      (i % 2 === 0 ? ana : mia).emit('request-chat', {
        requestChatUUID: requestChat.uuid,
        content: `mensaje ${i}`,
      });
    }
    await allDelivered;

    const { messages } = await getRequestChat(MEMBER);
    const sent = messages.slice(1);
    expect(sent).toHaveLength(CONCURRENT);
    expect(new Set(sent.map((m) => m.content)).size).toBe(CONCURRENT);
    // En orden: cada fecha es posterior a la anterior (ninguna se repite).
    const times = messages.map((m) => Date.parse(m.sentAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);

    // El createdAt devuelto es el persistido, y no cambia al volver a leer.
    const again = await getRequestChat(MEMBER);
    expect(again.messages.map((m) => m.sentAt)).toEqual(
      messages.map((m) => m.sentAt),
    );
  });

  it('el documento de la solicitud ya no embebe mensajes', async () => {
    const doc = await db.collection('requestchats').findOne({});

    expect(doc).not.toBeNull();
    expect(doc).not.toHaveProperty('messages');
  });

  it('las fechas salen en ISO-8601 UTC, en la solicitud y en el listado', async () => {
    const { messages } = await getRequestChat(APPLICANT);
    expect(messages.every((m) => ISO_UTC.test(m.sentAt))).toBe(true);

    const list = (
      await request(server)
        .get('/request-chats')
        .set('Authorization', tmaAuth(MEMBER))
        .expect(200)
    ).body as ListDto;
    const item = list.items.find((i) => i.uuid === requestChat.uuid)!;
    expect(item.lastMessage?.at).toMatch(ISO_UTC);
    expect(item.lastMessage?.at).toBe(messages.at(-1)!.sentAt);
  });

  it('al cerrarse por votos agrega el mensaje de sistema y avisa por socket con él', async () => {
    const ana = await connect(APPLICANT);
    const updated = new Promise<RequestChatDto>((resolve) =>
      ana.once('request-chat-update', resolve),
    );
    let closing: RequestChatDto | undefined;
    for (const member of [MEMBER, MEMBER_2, MEMBER_3]) {
      closing = (
        await request(server)
          .put(`/request-chats/${requestChat.uuid}/vote/reject`)
          .set('Authorization', tmaAuth(member))
          .expect(200)
      ).body as RequestChatDto;
    }

    expect(closing!.state).toBe('Rejected');
    const last = closing!.messages.at(-1)!;
    expect(last.content).toContain('rechazada');
    expect((await updated).messages.at(-1)!.uuid).toBe(last.uuid);
    const doc = await db.collection('requestchats').findOne({});
    expect(doc).not.toHaveProperty('messages');
    expect(doc).toMatchObject({ state: 'Rejected' });
  });
});
