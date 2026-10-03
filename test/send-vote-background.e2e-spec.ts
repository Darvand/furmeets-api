import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { Logger } from '@nestjs/common';
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

const MEMBERS = Array.from({ length: 5 }, (_, i) => ({
  id: 9501 + i,
  first_name: `Miembro ${i + 1}`,
}));
const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));
const [MEMBER] = MEMBERS;
const APPLICANT = { id: 9600, first_name: 'Ana' };
const APPLICANT_2 = { id: 9601, first_name: 'Beto' };
const APPLICANT_3 = { id: 9602, first_name: 'Ceci' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

/** Lo que tarda el Telegram simulado (criterio de T41). */
const TELEGRAM_DELAY_MS = 2_000;
/** Holgura para "no esperó a Telegram": muy por debajo de `TELEGRAM_DELAY_MS`. */
const FAST_MS = 1_000;

interface VoteDto {
  uuid: string;
  state: string;
  votes: { approved: number; rejected: number };
  userVote?: string;
}

const slow = () =>
  new Promise<void>((resolve) => setTimeout(resolve, TELEGRAM_DELAY_MS));

describe('Enviar y votar sin esperar a Telegram (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  const sockets: Socket[] = [];
  /** Líneas del log de tiempos (`Timing`), con las operaciones de Mongo de cada petición. */
  const timingLines: string[] = [];
  /** La solicitud de Ana: la cierra la última prueba. */
  let anaChatId: string;

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

  const createRequestChat = async (applicant: TelegramInitDataUser) => {
    const entity = await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(applicant, TEST_BOT_TOKEN));
    return (
      (
        await request(server)
          .post('/request-chats')
          .set('Authorization', tmaAuth(applicant))
          .send({ requesterUUID: entity.id.value })
          .expect(201)
      ).body as { uuid: string }
    ).uuid;
  };

  const vote = async (
    member: TelegramInitDataUser,
    id: string,
    type: 'approve' | 'reject',
  ) =>
    (
      await request(server)
        .put(`/request-chats/${id}/vote/${type}`)
        .set('Authorization', tmaAuth(member))
        .expect(200)
    ).body as VoteDto;

  /** Operaciones de Mongo de la última línea de tiempos que empieza con `prefix`. */
  const mongoOpsOf = (prefix: string): number => {
    const line = timingLines.filter((l) => l.startsWith(prefix)).at(-1);
    const match = line?.match(/mongo \d+ms\/(\d+)/);
    if (!match) {
      throw new Error(
        `Sin línea de tiempos para "${prefix}":\n${timingLines.join('\n')}`,
      );
    }
    return Number(match[1]);
  };

  const drain = () => testApp.app.get(BackgroundQueue).drain();

  /**
   * Comandos de Mongo que hace `fn`. La cola queda frenada mientras tanto, para contar
   * solo el camino crítico y no lo que corre después en segundo plano.
   */
  const mongoCommandsDuring = async <T>(
    fn: () => Promise<T>,
  ): Promise<{ result: T; commands: string[] }> => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    testApp.app.get(BackgroundQueue).enqueue('compuerta', () => gate);
    const commands: string[] = [];
    const client = testApp.app
      .get<Connection>(getConnectionToken())
      .getClient();
    const listener = (event: { commandName: string }) =>
      commands.push(event.commandName);
    client.on('commandStarted', listener);
    try {
      return { result: await fn(), commands };
    } finally {
      client.off('commandStarted', listener);
      release();
    }
  };

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(function (
      this: Logger,
      message: unknown,
    ) {
      if (this['context'] === 'Timing') timingLines.push(String(message));
    });
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
    // Registrados de antemano: así autenticar es una sola lectura.
    const auth = testApp.app.get(InitDataAuthService);
    await Promise.all(
      MEMBERS.map((m) => auth.authenticate(signInitData(m, TEST_BOT_TOKEN))),
    );
  });

  beforeEach(() => {
    const tg = testApp.telegramBot;
    // Telegram lento en todo lo que avisa.
    tg.sendMessageToGroup.mockReset().mockImplementation(slow);
    tg.sendMessageToUser.mockReset().mockImplementation(slow);
    tg.sendInviteLinkToUser.mockReset().mockImplementation(slow);
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await drain();
  });

  afterAll(async () => {
    await testApp?.close();
    jest.restoreAllMocks();
  });

  it('el ack y el emit de un mensaje no esperan a Telegram', async () => {
    const id = await createRequestChat(APPLICANT);
    anaChatId = id;
    const ana = await connect(APPLICANT);
    const member = await connect(MEMBER);
    const received = new Promise<{ content: string }>((resolve) =>
      member.once('request-chat', resolve),
    );

    const startedAt = Date.now();
    const ack = (await ana.emitWithAck('request-chat', {
      requestChatUUID: id,
      content: 'hola, soy Ana',
    })) as { uuid: string; content: string };

    expect(Date.now() - startedAt).toBeLessThan(FAST_MS);
    expect(ack.content).toBe('hola, soy Ana');
    expect((await received).content).toBe('hola, soy Ana');
    expect(Date.now() - startedAt).toBeLessThan(FAST_MS);
    // Enviar: leer solicitante y estado, e insertar.
    expect(mongoOpsOf('WS request-chat ok')).toBeLessThanOrEqual(2);
    await drain();
    expect(testApp.telegramBot.sendMessageToGroup).toHaveBeenCalledWith(
      expect.stringContaining('Ana'),
    );
  });

  it('si Telegram falla, el mensaje queda guardado y emitido, y el error se registra', async () => {
    const id = await createRequestChat(APPLICANT_2);
    const tg = testApp.telegramBot;
    tg.sendMessageToUser.mockRejectedValue(new Error('Telegram caído'));
    const errors = jest.spyOn(Logger.prototype, 'error');
    const member = await connect(MEMBER);
    const beto = await connect(APPLICANT_2);
    const received = new Promise<{ content: string }>((resolve) =>
      beto.once('request-chat', resolve),
    );

    await member.emitWithAck('request-chat', {
      requestChatUUID: id,
      content: 'hola, Beto',
    });
    await drain();

    expect((await received).content).toBe('hola, Beto');
    expect(tg.sendMessageToUser).toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Telegram caído'),
    );
    const stored = (
      await request(server)
        .get(`/request-chats/${id}`)
        .set('Authorization', tmaAuth(MEMBER))
        .expect(200)
    ).body as { messages: { content: string }[] };
    expect(stored.messages.at(-1)!.content).toBe('hola, Beto');
  });

  it('votar alterna el voto y responde solo estado y conteos', async () => {
    const id = await createRequestChat(APPLICANT_3);

    const approved = await vote(MEMBER, id, 'approve');
    expect(approved).toEqual({
      uuid: id,
      state: 'InProgress',
      votes: { approved: 1, rejected: 0 },
      userVote: 'approve',
    });
    // Un voto distinto reemplaza al anterior.
    expect(await vote(MEMBER, id, 'reject')).toMatchObject({
      votes: { approved: 0, rejected: 1 },
      userVote: 'reject',
    });
    // El mismo voto otra vez lo retira.
    const { result: removed, commands } = await mongoCommandsDuring(() =>
      vote(MEMBER, id, 'reject'),
    );
    expect(removed.votes).toEqual({ approved: 0, rejected: 0 });
    expect(removed.userVote).toBeUndefined();
    // Autenticar (find del usuario) + guardar el voto (findAndModify).
    expect(commands).toEqual(['find', 'findAndModify']);
  });

  it('el voto que cierra responde sin esperar a Telegram y avisa después', async () => {
    const id = anaChatId;
    const ana = await connect(APPLICANT);
    for (const member of MEMBERS.slice(0, 4)) {
      await vote(member, id, 'approve');
    }
    const updated = new Promise<{ state: string; messages: unknown[] }>(
      (resolve) => ana.once('request-chat-update', resolve),
    );

    const startedAt = Date.now();
    const { result: closing, commands } = await mongoCommandsDuring(() =>
      vote(MEMBERS[4], id, 'approve'),
    );
    const elapsed = Date.now() - startedAt;

    expect(closing.state).toBe('Approved');
    expect(elapsed).toBeLessThan(FAST_MS);
    // Autenticar (find) + guardar el voto (findAndModify) + cerrar (update).
    expect(commands).toEqual(['find', 'findAndModify', 'update']);
    expect((await updated).state).toBe('Approved');
    await drain();
    expect(testApp.telegramBot.sendMessageToGroup).toHaveBeenCalledWith(
      expect.stringContaining('ha sido aprobada'),
    );
    expect(testApp.telegramBot.sendInviteLinkToUser).toHaveBeenCalledWith(
      APPLICANT.id,
    );
  });
});
