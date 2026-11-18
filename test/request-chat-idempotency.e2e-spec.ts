import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
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

const MEMBER = { id: 9201, first_name: 'Mia' };
const APPLICANT = { id: 9202, first_name: 'Ana' };
const OTHER_APPLICANT = { id: 9203, first_name: 'Beto' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

/** Espera corta para confirmar que un evento NO llega. */
const SETTLE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MessageDto {
  uuid: string;
  content: string;
  clientMessageId?: string;
  sentAt: string;
}
interface RequestChatDto {
  uuid: string;
  messages: MessageDto[];
}
interface MessagePageDto {
  items: MessageDto[];
  hasMore: boolean;
}
interface WsError {
  message: string;
}

describe('Chat: idempotencia por clientMessageId y recuperación (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let db: Connection;
  let requestChat: RequestChatDto;
  let otherRequestChat: RequestChatDto;
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

  const apply = async (user: TelegramInitDataUser) => {
    await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));
    return (
      await request(server)
        .post('/applications')
        .set('Authorization', tmaAuth(user))
        .send({ age: 25, city: 'Bogotá' })
        .expect(201)
    ).body as RequestChatDto;
  };

  const storedWith = (clientMessageId: string) =>
    db.collection('requestchatmessages').find({ clientMessageId }).toArray();

  const messagesAfter = (
    user: TelegramInitDataUser,
    query: Record<string, string | number>,
    chat = requestChat,
  ) =>
    request(server)
      .get(`/request-chats/${chat.uuid}/messages`)
      .query(query)
      .set('Authorization', tmaAuth(user));

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
    db = testApp.app.get<Connection>(getConnectionToken());
    requestChat = await apply(APPLICANT);
    otherRequestChat = await apply(OTHER_APPLICANT);
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await testApp.app.get(BackgroundQueue).drain();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('idempotencia', () => {
    it('reenviar el mismo clientMessageId devuelve el mismo mensaje, sin duplicarlo ni volver a emitirlo', async () => {
      const [ana, mia] = await Promise.all([
        connect(APPLICANT),
        connect(MEMBER),
      ]);
      const received: MessageDto[] = [];
      mia.on('request-chat', (dto: MessageDto) => received.push(dto));
      const clientMessageId = randomUUID();
      const payload = {
        requestChatUUID: requestChat.uuid,
        content: 'hola, soy Ana',
        clientMessageId,
      };

      const first = (await send(ana, payload)) as MessageDto;
      // El ack se perdió y la App reintenta con el mismo id (T42).
      const retry = (await send(ana, payload)) as MessageDto;
      await sleep(SETTLE_MS);

      expect(retry.uuid).toBe(first.uuid);
      expect(retry.clientMessageId).toBe(clientMessageId);
      expect(retry.sentAt).toBe(first.sentAt);
      expect(await storedWith(clientMessageId)).toHaveLength(1);
      expect(received.map((m) => m.uuid)).toEqual([first.uuid]);
    });

    it('varios envíos simultáneos con el mismo id dejan un solo mensaje', async () => {
      const ana = await connect(APPLICANT);
      const clientMessageId = randomUUID();
      const payload = {
        requestChatUUID: requestChat.uuid,
        content: 'doble toque',
        clientMessageId,
      };

      const acks = (await Promise.all(
        [1, 2, 3, 4, 5].map(() => send(ana, payload)),
      )) as MessageDto[];

      expect(new Set(acks.map((a) => a.uuid)).size).toBe(1);
      expect(await storedWith(clientMessageId)).toHaveLength(1);
    });

    it('el mismo clientMessageId de dos autores son dos mensajes', async () => {
      const [ana, mia] = await Promise.all([
        connect(APPLICANT),
        connect(MEMBER),
      ]);
      const clientMessageId = randomUUID();

      const fromAna = (await send(ana, {
        requestChatUUID: requestChat.uuid,
        content: 'de Ana',
        clientMessageId,
      })) as MessageDto;
      const fromMia = (await send(mia, {
        requestChatUUID: requestChat.uuid,
        content: 'de Mia',
        clientMessageId,
      })) as MessageDto;

      expect(fromMia.uuid).not.toBe(fromAna.uuid);
      expect(await storedWith(clientMessageId)).toHaveLength(2);
    });

    it('el historial trae el clientMessageId: tras reconectar, la App confirma sus mensajes pendientes', async () => {
      const ana = await connect(APPLICANT);
      const clientMessageId = randomUUID();
      await send(ana, {
        requestChatUUID: requestChat.uuid,
        content: 'quedó guardado',
        clientMessageId,
      });

      const chat = (
        await request(server)
          .get(`/request-chats/${requestChat.uuid}`)
          .set('Authorization', tmaAuth(APPLICANT))
          .expect(200)
      ).body as RequestChatDto;

      expect(
        chat.messages.find((m) => m.content === 'quedó guardado')
          ?.clientMessageId,
      ).toBe(clientMessageId);
    });
  });

  describe('validación del texto', () => {
    it.each([
      ['de más de 4096 caracteres', 'a'.repeat(4097)],
      ['solo con espacios', '   \n '],
    ])('un mensaje %s → invalid-payload y no se guarda', async (_, content) => {
      const ana = await connect(APPLICANT);
      const before = await db
        .collection('requestchatmessages')
        .countDocuments();

      const result = await send(ana, {
        requestChatUUID: requestChat.uuid,
        content,
        clientMessageId: randomUUID(),
      });

      expect((result as WsError).message).toBe('invalid-payload');
      expect(await db.collection('requestchatmessages').countDocuments()).toBe(
        before,
      );
    });

    it('un mensaje de 4096 caracteres se acepta', async () => {
      const ana = await connect(APPLICANT);

      const ack = (await send(ana, {
        requestChatUUID: requestChat.uuid,
        content: 'a'.repeat(4096),
      })) as MessageDto;

      expect(ack.uuid).toBeDefined();
    });
  });

  describe('recuperación: GET /request-chats/:id/messages?after=', () => {
    it('trae solo los mensajes posteriores, en orden, también los de otros', async () => {
      const [ana, mia] = await Promise.all([
        connect(APPLICANT),
        connect(MEMBER),
      ]);
      const last = (await send(ana, {
        requestChatUUID: requestChat.uuid,
        content: 'antes del corte',
      })) as MessageDto;
      // Mientras Ana está sin conexión, el grupo sigue escribiendo.
      for (const content of ['uno', 'dos', 'tres']) {
        await send(mia, { requestChatUUID: requestChat.uuid, content });
      }

      const res = await messagesAfter(APPLICANT, { after: last.uuid }).expect(
        200,
      );

      const page = res.body as MessagePageDto;
      expect(page.items.map((m) => m.content)).toEqual(['uno', 'dos', 'tres']);
      expect(page.hasMore).toBe(false);
    });

    it('pagina con limit: hasMore indica que hay que pedir desde el último', async () => {
      const mia = await connect(MEMBER);
      const start = (await send(mia, {
        requestChatUUID: requestChat.uuid,
        content: 'inicio',
      })) as MessageDto;
      for (const content of ['a', 'b', 'c']) {
        await send(mia, { requestChatUUID: requestChat.uuid, content });
      }

      const first = (
        await messagesAfter(MEMBER, { after: start.uuid, limit: 2 }).expect(200)
      ).body as MessagePageDto;
      const rest = (
        await messagesAfter(MEMBER, {
          after: first.items[1].uuid,
          limit: 2,
        }).expect(200)
      ).body as MessagePageDto;

      expect(first.items.map((m) => m.content)).toEqual(['a', 'b']);
      expect(first.hasMore).toBe(true);
      expect(rest.items.map((m) => m.content)).toEqual(['c']);
      expect(rest.hasMore).toBe(false);
    });

    it('un after de otra solicitud → 400', async () => {
      const beto = await connect(OTHER_APPLICANT);
      const foreign = (await send(beto, {
        requestChatUUID: otherRequestChat.uuid,
        content: 'de otra solicitud',
      })) as MessageDto;

      await messagesAfter(MEMBER, { after: foreign.uuid }).expect(400);
    });

    it.each([
      ['un after que no es UUID', { after: 'no-es-uuid' }],
      ['sin after', {}],
      ['un limit mayor a 100', { after: randomUUID(), limit: 101 }],
    ])('%s → 400', async (_, query) => {
      await messagesAfter(MEMBER, query).expect(400);
    });

    it('otro solicitante → 403', async () => {
      await messagesAfter(OTHER_APPLICANT, { after: randomUUID() }).expect(403);
    });
  });
});
