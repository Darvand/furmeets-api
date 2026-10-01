import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { CHAT_PROVIDERS } from '../src/chat/chat.providers';
import { RequestChatEntity } from '../src/chat/domain/entities/request-chat.entity';
import type { ChatRepository } from '../src/chat/domain/services/chat.repository';
import { UserEntity } from '../src/members/domain/entities/user.entity';
import { createTestApp, TEST_BOT_TOKEN, TestApp } from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const DAY_MS = 24 * 60 * 60 * 1000;
const ANA = { id: 5001, first_name: 'Ana' };
const BETO = { id: 5002, first_name: 'Beto' };

type MessageDto = { content: string; user: { uuid: string; name: string } };

describe('Autenticación del socket por initData (e2e)', () => {
  let testApp: TestApp;
  let url: string;
  const sockets: Socket[] = [];

  const connect = (auth?: Record<string, unknown>): Socket => {
    const socket = io(url, {
      auth,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    sockets.push(socket);
    return socket;
  };

  /** Resuelve al conectar; rechaza con el mensaje del `connect_error`. */
  const connected = (socket: Socket): Promise<void> =>
    new Promise((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', (error) => reject(error));
    });

  const authenticate = (user: TelegramInitDataUser): Promise<UserEntity> =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  beforeAll(async () => {
    testApp = await createTestApp();
    // Beto es miembro del grupo; Ana es solicitante.
    testApp.telegramBot.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === BETO.id ? 'member' : 'left' }),
    );
    await testApp.app.listen(0);
    const server = testApp.app.getHttpServer() as Server;
    const { port } = server.address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('rechaza la conexión', () => {
    it('sin initData', async () => {
      await expect(connected(connect())).rejects.toThrow('unauthorized');
    });

    it('con firma inválida', async () => {
      const socket = connect({ initData: signInitData(ANA, 'otro:token') });
      await expect(connected(socket)).rejects.toThrow('unauthorized');
    });

    it('con initData vencido', async () => {
      const authDate = new Date(Date.now() - DAY_MS - 60_000);
      const socket = connect({
        initData: signInitData(ANA, TEST_BOT_TOKEN, { authDate }),
      });
      await expect(connected(socket)).rejects.toThrow('unauthorized');
    });

    it('con initData que no es texto', async () => {
      const socket = connect({ initData: { user: ANA } });
      await expect(connected(socket)).rejects.toThrow('unauthorized');
    });
  });

  it('acepta la conexión con initData válido', async () => {
    const socket = connect({ initData: signInitData(ANA, TEST_BOT_TOKEN) });
    await expect(connected(socket)).resolves.toBeUndefined();
  });

  it('un mensaje de un miembro con userUUID ajeno queda a su nombre', async () => {
    const ana = await authenticate(ANA);
    const requestChat = RequestChatEntity.asNew(ana, 'furros', 'Instagram');
    const chats = testApp.app.get<ChatRepository>(
      CHAT_PROVIDERS.RequestChatRepository,
    );
    await chats.createRequestChat(requestChat);

    const socket = connect({ initData: signInitData(BETO, TEST_BOT_TOKEN) });
    await connected(socket);
    const received = new Promise<MessageDto>((resolve) =>
      socket.once('request-chat', resolve),
    );
    socket.emit('request-chat', {
      requestChatUUID: requestChat.id.value,
      userUUID: ana.id.value,
      content: 'hola, soy Beto',
    });

    const message = await received;
    const beto = await authenticate(BETO);
    expect(message.content).toBe('hola, soy Beto');
    expect(message.user).toMatchObject({ uuid: beto.id.value, name: 'Beto' });

    const stored = await chats.getRequestChatByUUID(requestChat.id);
    const last = stored!.props.messages.at(-1)!;
    expect(last.props.content).toBe('hola, soy Beto');
    expect(last.props.user.telegramId).toBe(BETO.id);
  });
});
