import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { CHAT_PROVIDERS } from '../src/chat/chat.providers';
import { RequestChatEntity } from '../src/chat/domain/entities/request-chat.entity';
import { ApplicationForm } from '../src/applications/domain/application-form';
import type { ChatRepository } from '../src/chat/domain/services/chat.repository';
import type { RequestChatMessageRepository } from '../src/chat/domain/services/request-chat-message.repository';
import { UserService } from '../src/members/application/user.service';
import { UserEntity } from '../src/members/domain/entities/user.entity';
import type { ChatMemberUpdate } from '../src/telegram-bot/telegram-bot.service';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBER = { id: 8001, first_name: 'Mia' };
const APPLICANT_A = { id: 8002, first_name: 'Ana' };
const APPLICANT_B = { id: 8003, first_name: 'Beto' };
const APPLICANT_C = { id: 8004, first_name: 'Caro' };
const EXPELLED = { id: 8005, first_name: 'Eli' };

const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

/** Tiempo para confirmar que un evento NO llegó (el emit ya llegó a otro socket). */
const SETTLE_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type MessageDto = { content: string };

describe('Autorización por rol (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let chats: ChatRepository;
  let messages: RequestChatMessageRepository;
  const statuses = new Map<number, string>([
    [MEMBER.id, 'member'],
    [EXPELLED.id, 'member'],
  ]);
  const users = new Map<number, UserEntity>();
  let requestA: RequestChatEntity;
  let requestB: RequestChatEntity;
  const sockets: Socket[] = [];

  const auth = (user: TelegramInitDataUser) => tmaAuth(user);

  const authenticate = async (user: TelegramInitDataUser) => {
    const entity = await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));
    users.set(user.id, entity);
    return entity;
  };

  const createRequestFor = async (user: TelegramInitDataUser) => {
    // Como en producción: toda solicitud nace con el mensaje de bienvenida del bot.
    const requestChat = RequestChatEntity.apply(
      users.get(user.id)!,
      ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
    );
    await chats.createRequestChat(requestChat);
    await messages.insert(
      requestChat.welcomeMessage(
        await testApp.app.get(UserService).getBotUser(),
        new Date(),
      ),
    );
    return requestChat;
  };

  /** Simula el update `chat_member` que Telegram envía al bot. */
  const chatMemberUpdate = (user: TelegramInitDataUser, status: string) => {
    statuses.set(user.id, status);
    const [[handler]] = testApp.telegramBot.onChatMember.mock.calls as [
      [(update: ChatMemberUpdate) => void],
    ];
    handler({ chatId: Number(TEST_GROUP_ID), userId: user.id, status });
  };

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
    // Las salas se asignan justo después de conectar.
    await sleep(SETTLE_MS);
    return socket;
  };

  /** Mensajes que recibe un socket. */
  const inbox = (socket: Socket) => {
    const received: MessageDto[] = [];
    socket.on('request-chat', (message: MessageDto) => received.push(message));
    return received;
  };

  const send = (
    socket: Socket,
    requestChat: RequestChatEntity,
    content: string,
  ) =>
    socket.emit('request-chat', {
      requestChatUUID: requestChat.id.value,
      content,
    });

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: statuses.get(id) ?? 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    await testApp.app.listen(0);
    server = testApp.app.getHttpServer() as App;
    const { port } = (server as unknown as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    chats = testApp.app.get<ChatRepository>(
      CHAT_PROVIDERS.RequestChatRepository,
    );
    messages = testApp.app.get<RequestChatMessageRepository>(
      CHAT_PROVIDERS.RequestChatMessageRepository,
    );

    for (const user of [
      MEMBER,
      APPLICANT_A,
      APPLICANT_B,
      APPLICANT_C,
      EXPELLED,
    ]) {
      await authenticate(user);
    }
    requestA = await createRequestFor(APPLICANT_A);
    requestB = await createRequestFor(APPLICANT_B);
    // Crea el grupo (primer arranque) y agrega al miembro.
    await request(server)
      .get('/me')
      .set('Authorization', auth(MEMBER))
      .expect(200);
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('HTTP', () => {
    it.each([
      ['miembro lista las solicitudes', 200, MEMBER],
      ['solicitante lista las solicitudes', 403, APPLICANT_A],
    ])('%s → %i', async (_, status, user) => {
      await request(server)
        .get('/request-chats')
        .set('Authorization', auth(user))
        .expect(status);
    });

    it.each([
      ['solicitante pide su solicitud', 200, APPLICANT_A],
      ['solicitante pide la solicitud de otro', 403, APPLICANT_B],
      ['miembro pide cualquier solicitud', 200, MEMBER],
    ])('%s → %i', async (_, status, user) => {
      await request(server)
        .get(`/request-chats/${requestA.id.value}`)
        .set('Authorization', auth(user))
        .expect(status);
    });

    it('solicitante pide una solicitud que no existe → 403 (no revela si existe)', async () => {
      await request(server)
        .get(`/request-chats/${randomUUID()}`)
        .set('Authorization', auth(APPLICANT_A))
        .expect(403);
    });

    it.each([
      ['solicitante vota su propia solicitud', 403, APPLICANT_A],
      ['solicitante vota la solicitud de otro', 403, APPLICANT_B],
      ['miembro vota', 200, MEMBER],
    ])('%s → %i', async (_, status, user) => {
      await request(server)
        .put(`/request-chats/${requestA.id.value}/vote/approve`)
        .set('Authorization', auth(user))
        .expect(status);
    });

    it('miembro crea una solicitud → 403', async () => {
      await request(server)
        .post('/applications')
        .set('Authorization', auth(MEMBER))
        .send({ age: 25, city: 'Bogotá' })
        .expect(403);
    });

    it.each([
      ['solicitante se pide a sí mismo', 200, APPLICANT_A, APPLICANT_A],
      ['solicitante pide a otro usuario', 403, APPLICANT_A, MEMBER],
      ['miembro pide a otro usuario', 200, MEMBER, APPLICANT_A],
    ])('GET /users: %s → %i', async (_, status, user, target) => {
      await request(server)
        .get(`/users/${target.id}`)
        .set('Authorization', auth(user))
        .expect(status);
    });

    it('GET /groups: la lista de miembros solo la ve un miembro', async () => {
      const asMember = await request(server)
        .get('/groups')
        .set('Authorization', auth(MEMBER))
        .expect(200);
      const asApplicant = await request(server)
        .get('/groups')
        .set('Authorization', auth(APPLICANT_A))
        .expect(200);

      expect(
        (asMember.body as { members: unknown[] }).members,
      ).not.toHaveLength(0);
      expect(asApplicant.body).toMatchObject({ members: [] });
    });

    it('un miembro expulsado ya no puede votar en la siguiente petición (RNF-SEG-10)', async () => {
      await request(server)
        .put(`/request-chats/${requestB.id.value}/vote/approve`)
        .set('Authorization', auth(EXPELLED))
        .expect(200);

      chatMemberUpdate(EXPELLED, 'kicked');

      await request(server)
        .put(`/request-chats/${requestB.id.value}/vote/reject`)
        .set('Authorization', auth(EXPELLED))
        .expect(403);
      chatMemberUpdate(EXPELLED, 'member');
    });
  });

  describe('socket', () => {
    it('un solicitante solo recibe los mensajes de su solicitud; los miembros, todos', async () => {
      const member = await connect(MEMBER);
      const a = await connect(APPLICANT_A);
      const b = await connect(APPLICANT_B);
      const [memberInbox, aInbox, bInbox] = [inbox(member), inbox(a), inbox(b)];

      send(member, requestA, 'hola A');
      send(member, requestB, 'hola B');
      await sleep(SETTLE_MS * 3);

      expect(memberInbox.map((m) => m.content).sort()).toEqual([
        'hola A',
        'hola B',
      ]);
      expect(aInbox.map((m) => m.content)).toEqual(['hola A']);
      expect(bInbox.map((m) => m.content)).toEqual(['hola B']);
    });

    it('un solicitante no puede escribir en la solicitud de otro', async () => {
      const a = await connect(APPLICANT_A);
      const b = await connect(APPLICANT_B);
      const bInbox = inbox(b);
      const rejected = new Promise<{ message: string }>((resolve) =>
        a.once('exception', resolve),
      );
      const before = (await messages.findByRequestChat(requestB.id)).length;

      send(a, requestB, 'intruso');

      expect((await rejected).message).toBe('forbidden');
      await sleep(SETTLE_MS);
      expect(bInbox).toHaveLength(0);
      const after = (await messages.findByRequestChat(requestB.id)).length;
      expect(after).toBe(before);
    });

    it('el solicitante escribe en su chat: lo ven los miembros, no otros solicitantes', async () => {
      const member = await connect(MEMBER);
      const a = await connect(APPLICANT_A);
      const b = await connect(APPLICANT_B);
      const [memberInbox, bInbox] = [inbox(member), inbox(b)];

      send(a, requestA, 'soy Ana');
      await sleep(SETTLE_MS * 3);

      expect(memberInbox.map((m) => m.content)).toEqual(['soy Ana']);
      expect(bInbox).toHaveLength(0);
    });

    it('al crear su solicitud, el socket abierto del solicitante entra a su sala', async () => {
      const c = await connect(APPLICANT_C);
      const member = await connect(MEMBER);
      const cInbox = inbox(c);
      const newRequests: unknown[] = [];
      c.on('new-request-chat', (dto) => newRequests.push(dto));

      const res = await request(server)
        .post('/applications')
        .set('Authorization', auth(APPLICANT_C))
        .send({ age: 25, city: 'Bogotá' })
        .expect(201);
      const requestC = { id: { value: (res.body as { uuid: string }).uuid } };
      await sleep(SETTLE_MS);

      send(member, requestC as RequestChatEntity, 'bienvenida, Caro');
      await sleep(SETTLE_MS * 3);

      expect(cInbox.map((m) => m.content)).toEqual(['bienvenida, Caro']);
      // El aviso de nueva solicitud es solo para miembros.
      expect(newRequests).toHaveLength(0);
    });

    it('un miembro expulsado deja de recibir los eventos de las solicitudes', async () => {
      const member = await connect(MEMBER);
      const expelled = await connect(EXPELLED);
      const expelledInbox = inbox(expelled);

      chatMemberUpdate(EXPELLED, 'kicked');
      await sleep(SETTLE_MS);
      send(member, requestB, 'después de expulsar');
      await sleep(SETTLE_MS * 3);

      expect(expelledInbox).toHaveLength(0);
      chatMemberUpdate(EXPELLED, 'member');
    });
  });
});
