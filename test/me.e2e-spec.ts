import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { CHAT_PROVIDERS } from '../src/chat/chat.providers';
import { RequestChatEntity } from '../src/chat/domain/entities/request-chat.entity';
import { ApplicationForm } from '../src/applications/domain/application-form';
import type { ChatRepository } from '../src/chat/domain/services/chat.repository';
import type { ChatMemberUpdate } from '../src/telegram-bot/telegram-bot.service';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

type MeBody = {
  user: { telegramId: number; name: string };
  role: string;
  requestChatId?: string;
  requestChatState?: string;
};

describe('GET /me (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  /** Estado de cada usuario en Telegram, por telegramId. */
  const statuses = new Map<number, string>();

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: statuses.get(id) ?? 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const me = async (user: TelegramInitDataUser): Promise<MeBody> => {
    const res = await request(server)
      .get('/me')
      .set('Authorization', tmaAuth(user))
      .expect(200);
    return res.body as MeBody;
  };

  /** Simula el update `chat_member` que Telegram envía al bot. */
  const chatMemberUpdate = (userId: number, status: string) => {
    statuses.set(userId, status);
    const [[handler]] = testApp.telegramBot.onChatMember.mock.calls as [
      [(update: ChatMemberUpdate) => void],
    ];
    handler({ chatId: Number(TEST_GROUP_ID), userId, status });
  };

  it('sin autenticación → 401', async () => {
    await request(server).get('/me').expect(401);
  });

  it('miembro según Telegram → role member, sin solicitud', async () => {
    statuses.set(7001, 'administrator');

    const body = await me({ id: 7001, first_name: 'Ana' });

    expect(body).toMatchObject({
      role: 'member',
      user: { telegramId: 7001, name: 'Ana' },
    });
    expect(body).not.toHaveProperty('requestChatId');
  });

  it('no miembro sin solicitud → role applicant, sin requestChatId', async () => {
    const body = await me({ id: 7002, first_name: 'Beto' });

    expect(body.role).toBe('applicant');
    expect(body).not.toHaveProperty('requestChatId');
  });

  it('solicitante con solicitud → incluye su id y estado', async () => {
    const caro = { id: 7003, first_name: 'Caro' };
    const requester = await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(caro, TEST_BOT_TOKEN));
    const requestChat = RequestChatEntity.apply(
      requester,
      ApplicationForm.submit({ age: 25, city: 'Bogotá' }),
    );
    await testApp.app
      .get<ChatRepository>(CHAT_PROVIDERS.RequestChatRepository)
      .createRequestChat(requestChat);

    const body = await me(caro);

    expect(body).toMatchObject({
      role: 'applicant',
      requestChatId: requestChat.id.value,
      requestChatState: 'InProgress',
    });
  });

  it('con la caché caliente no vuelve a consultar a Telegram', async () => {
    const dani = { id: 7004, first_name: 'Dani' };
    statuses.set(dani.id, 'member');
    const calls = () =>
      testApp.telegramBot.getMemberFromGroup.mock.calls.filter(
        ([id]) => id === dani.id,
      ).length;

    await me(dani);
    await me(dani);

    expect(calls()).toBe(1);
  });

  it('el rol se basa en Telegram, no en group.members de la BD', async () => {
    const eva = { id: 7005, first_name: 'Eva' };
    statuses.set(eva.id, 'member');
    expect((await me(eva)).role).toBe('member');

    // Telegram dice que salió, pero la BD aún la tiene como miembro.
    chatMemberUpdate(eva.id, 'left');

    expect((await me(eva)).role).toBe('applicant');
  });

  it('un miembro expulsado es solicitante en la siguiente petición (chat_member)', async () => {
    const fede = { id: 7006, first_name: 'Fede' };
    statuses.set(fede.id, 'member');
    expect((await me(fede)).role).toBe('member');

    chatMemberUpdate(fede.id, 'kicked');

    expect((await me(fede)).role).toBe('applicant');
  });

  it('sin el update chat_member el rol cacheado se mantiene hasta que vence', async () => {
    const gabi = { id: 7007, first_name: 'Gabi' };
    statuses.set(gabi.id, 'member');
    await me(gabi);

    statuses.set(gabi.id, 'kicked');

    expect((await me(gabi)).role).toBe('member');
  });
});
