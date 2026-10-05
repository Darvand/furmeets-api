import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { BackgroundQueue } from '../src/shared/async/background-queue';
import { migrate } from '../scripts/migrations/002-system-messages';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBER = { id: 9401, first_name: 'Mia' };
const APPLICANT = { id: 9402, first_name: 'Ana' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

/** Espera corta para confirmar que un evento NO llega. */
const SETTLE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MessageDto {
  uuid: string;
  type: 'user' | 'system';
  content: string;
  clientMessageId?: string;
}
interface RequestChatDto {
  uuid: string;
  messages: MessageDto[];
}
interface WsError {
  message: string;
  cause?: { pattern?: string; data?: { clientMessageId?: string } };
}

describe('Chat: mensajes de sistema y solo lectura (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let db: mongo.Db;
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

  /** Envía y devuelve el ack, o la excepción si la API rechaza el mensaje. */
  const send = (socket: Socket, payload: object) =>
    new Promise<MessageDto | WsError>((resolve) => {
      socket.once('exception', resolve);
      socket.emit('request-chat', payload, (ack: MessageDto) => {
        socket.off('exception', resolve);
        resolve(ack);
      });
    });

  const open = async () =>
    (
      await request(server)
        .get(`/request-chats/${requestChat.uuid}`)
        .set('Authorization', tmaAuth(MEMBER))
        .expect(200)
    ).body as RequestChatDto;

  const messages = () =>
    db.collection('requestchatmessages').find({
      requestChatId: new mongo.UUID(requestChat.uuid),
    });

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === MEMBER.id ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    await testApp.app.listen(0);
    server = testApp.app.getHttpServer() as App;
    const { port } = (server as unknown as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    db = testApp.app.get<Connection>(getConnectionToken()).db!;

    await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(APPLICANT, TEST_BOT_TOKEN));
    requestChat = (
      await request(server)
        .post('/applications')
        .set('Authorization', tmaAuth(APPLICANT))
        .send({ age: 25, city: 'Bogotá' })
        .expect(201)
    ).body as RequestChatDto;
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await testApp.app.get(BackgroundQueue).drain();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('la bienvenida es de tipo sistema y un mensaje del solicitante, de usuario', async () => {
    const ana = await connect(APPLICANT);
    const ack = (await send(ana, {
      requestChatUUID: requestChat.uuid,
      content: 'hola',
    })) as MessageDto;

    expect(requestChat.messages.map((m) => m.type)).toEqual(['system']);
    expect(ack.type).toBe('user');
    expect((await open()).messages.map((m) => [m.type, m.content])).toEqual([
      ['system', requestChat.messages[0].content],
      ['user', 'hola'],
    ]);
  });

  describe('mensajes del bot anteriores a T19 (migración 002)', () => {
    it('se leen como de usuario hasta migrar; después, como de sistema', async () => {
      // Como antes de T19: el mensaje del bot sin `type`.
      await db
        .collection('requestchatmessages')
        .updateMany(
          { requestChatId: new mongo.UUID(requestChat.uuid) },
          { $unset: { type: '' } },
        );
      expect((await open()).messages.map((m) => m.type)).toEqual([
        'user',
        'user',
      ]);

      const dryRun = await migrate(db, { botTelegramId: BOT.id, apply: false });
      expect(dryRun).toMatchObject({ pending: 1, marked: 0 });
      expect((await open()).messages[0].type).toBe('user');

      const applied = await migrate(db, { botTelegramId: BOT.id, apply: true });
      expect(applied).toMatchObject({
        bot: { username: 'furbot' },
        pending: 1,
        marked: 1,
      });
      expect((await open()).messages.map((m) => m.type)).toEqual([
        'system',
        'user',
      ]);

      const again = await migrate(db, { botTelegramId: BOT.id, apply: true });
      expect(again).toMatchObject({ pending: 0, marked: 0 });
    });

    it('con un BOT_TELEGRAM_ID que no existe no marca nada', async () => {
      const report = await migrate(db, { botTelegramId: 123, apply: true });

      expect(report.bot).toBeUndefined();
      expect(report.marked).toBe(0);
    });
  });

  describe('solicitud cerrada: solo lectura', () => {
    beforeAll(async () => {
      await db
        .collection<{ _id: mongo.UUID; state: string }>('requestchats')
        .updateOne(
          { _id: new mongo.UUID(requestChat.uuid) },
          { $set: { state: 'Approved' } },
        );
    });

    it.each([
      ['el solicitante', APPLICANT],
      ['un miembro', MEMBER],
    ])(
      '%s no puede escribir: request-chat-closed, sin guardar ni emitir',
      async (_, user) => {
        const [sender, other] = await Promise.all([
          connect(user),
          connect(user === MEMBER ? APPLICANT : MEMBER),
        ]);
        const received: MessageDto[] = [];
        other.on('request-chat', (m: MessageDto) => received.push(m));
        const before = await messages().count();
        const clientMessageId = randomUUID();

        const error = (await send(sender, {
          requestChatUUID: requestChat.uuid,
          clientMessageId,
          content: 'tarde',
        })) as WsError;

        expect(error.message).toBe('request-chat-closed');
        // Con el `clientMessageId`, la App marca su mensaje como no enviado.
        expect(error.cause?.data?.clientMessageId).toBe(clientMessageId);
        await sleep(SETTLE_MS);
        expect(received).toHaveLength(0);
        expect(await messages().count()).toBe(before);
        expect(testApp.telegramBot.sendMessageToGroup).not.toHaveBeenCalledWith(
          expect.stringContaining('tarde'),
        );
      },
    );

    it('el historial se sigue leyendo', async () => {
      expect((await open()).messages.length).toBeGreaterThan(0);
    });
  });
});
