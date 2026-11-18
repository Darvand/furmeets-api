import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { CHAT_PROVIDERS } from '../src/chat/chat.providers';
import { RequestChatMessageEntity } from '../src/chat/domain/entities/request-chat-message.entity';
import type { RequestChatMessageRepository } from '../src/chat/domain/services/request-chat-message.repository';
import { BackgroundQueue } from '../src/shared/async/background-queue';
import { UUID } from '../src/shared/domain/value-objects/uuid.value-object';
import {
  BACKUP_COLLECTION,
  migrate,
} from '../scripts/migrations/002-drop-bot-messages';
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
  content: string;
}
interface RequestChatDto {
  uuid: string;
  messages: MessageDto[];
}
interface WsError {
  message: string;
  cause?: { pattern?: string; data?: { clientMessageId?: string } };
}

describe('Chat: solo lectura y sin mensajes del bot (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let db: mongo.Db;
  let requestChat: RequestChatDto;
  const sockets: Socket[] = [];

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

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

  const contents = async () =>
    (
      (
        await request(server)
          .get(`/request-chats/${requestChat.uuid}`)
          .set('Authorization', tmaAuth(MEMBER))
          .expect(200)
      ).body as RequestChatDto
    ).messages.map((m) => m.content);

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

    await authenticate(APPLICANT);
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

  describe('migración 002: mensajes del bot anteriores a T19', () => {
    beforeAll(async () => {
      // Como antes de T19: bienvenida del bot, un mensaje de Ana y el resultado del bot.
      const [bot, ana] = await Promise.all([
        authenticate(BOT),
        authenticate(APPLICANT),
      ]);
      const repository = testApp.app.get<RequestChatMessageRepository>(
        CHAT_PROVIDERS.RequestChatMessageRepository,
      );
      const id = UUID.from(requestChat.uuid);
      const at = Date.now();
      for (const [author, content, offset] of [
        [bot, '¡Hola! En este chat podrás comunicarte…', 0],
        [ana, 'hola, soy Ana', 1],
        [bot, '¡Felicidades! Tu solicitud ha sido aprobada.', 2],
      ] as const) {
        await repository.insert(
          RequestChatMessageEntity.send(
            id,
            author,
            { content },
            new Date(at + offset),
          ),
        );
      }
    });

    it('sin --apply solo informa', async () => {
      const report = await migrate(db, { botTelegramId: BOT.id, apply: false });

      expect(report).toMatchObject({
        bot: { username: 'furbot' },
        found: 2,
        deleted: 0,
      });
      expect(await contents()).toHaveLength(3);
    });

    it('con --apply quita los del bot, después de respaldarlos, y deja los demás', async () => {
      const report = await migrate(db, { botTelegramId: BOT.id, apply: true });

      expect(report).toMatchObject({ found: 2, backedUp: 2, deleted: 2 });
      expect(await contents()).toEqual(['hola, soy Ana']);
      const backup = await db.collection(BACKUP_COLLECTION).find().toArray();
      expect(backup.map((doc) => doc.content as string).sort()).toEqual([
        '¡Felicidades! Tu solicitud ha sido aprobada.',
        '¡Hola! En este chat podrás comunicarte…',
      ]);
    });

    it('correrla de nuevo no cambia nada', async () => {
      const report = await migrate(db, { botTelegramId: BOT.id, apply: true });

      expect(report).toMatchObject({ found: 0, deleted: 0 });
      expect(await contents()).toEqual(['hola, soy Ana']);
      expect(await db.collection(BACKUP_COLLECTION).countDocuments()).toBe(2);
    });

    it('con un BOT_TELEGRAM_ID que no existe no quita nada', async () => {
      const report = await migrate(db, { botTelegramId: 123, apply: true });

      expect(report.bot).toBeUndefined();
      expect(report.deleted).toBe(0);
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
        const before = await contents();
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
        expect(await contents()).toEqual(before);
        expect(testApp.telegramBot.sendMessageToGroup).not.toHaveBeenCalledWith(
          expect.stringContaining('tarde'),
        );
      },
    );

    it('el historial se sigue leyendo', async () => {
      expect(await contents()).toEqual(['hola, soy Ana']);
    });
  });
});
