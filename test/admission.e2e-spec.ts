import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { BackgroundQueue } from '../src/shared/async/background-queue';
import type {
  ChatJoinRequestUpdate,
  ChatMemberUpdate,
} from '../src/telegram-bot/telegram-bot.service';
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
const ANA = { id: 9600, first_name: 'Ana' };
const INTRUSO = { id: 9601, first_name: 'Intruso' };
const BETO = { id: 9602, first_name: 'Beto' };
const CARO = { id: 9603, first_name: 'Caro' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

type MeBody = {
  role: string;
  requestChatId?: string;
  requestChatState?: string;
  inviteLink?: string;
};

interface StoredRequestChat {
  _id: mongo.UUID;
  inviteLink?: string;
  admittedAt?: Date;
}

/** Criterio de éxito 6 (SPEC §13) y RNF-SEG-09/10: admisión por solicitud de unión. */
describe('Admisión por solicitud de unión (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let db: Connection;
  /** Estado de cada usuario en Telegram, por telegramId. */
  const statuses = new Map<number, string>(
    MEMBERS.map((m) => [m.id, 'member']),
  );
  let anaRequestChatId: string;
  let anaLink: string;

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  const apply = async (applicant: TelegramInitDataUser): Promise<string> => {
    await authenticate(applicant);
    const res = await request(server)
      .post('/applications')
      .set('Authorization', tmaAuth(applicant))
      .send({ age: 25, city: 'Bogotá' })
      .expect(201);
    return (res.body as { uuid: string }).uuid;
  };

  const voteAll = async (id: string, type: 'approve' | 'reject') => {
    for (const member of MEMBERS) {
      await request(server)
        .put(`/request-chats/${id}/vote/${type}`)
        .set('Authorization', tmaAuth(member))
        .expect(200);
    }
    await testApp.app.get(BackgroundQueue).drain();
  };

  const me = async (user: TelegramInitDataUser): Promise<MeBody> =>
    (
      await request(server)
        .get('/me')
        .set('Authorization', tmaAuth(user))
        .expect(200)
    ).body as MeBody;

  const stored = (id: string) =>
    db
      .collection<StoredRequestChat>('requestchats')
      .findOne({ _id: new mongo.UUID(id) });

  /** Simula el update `chat_join_request` que Telegram envía al bot. */
  const joinRequest = async (userId: number, inviteLink?: string) => {
    const [[handler]] = testApp.telegramBot.onChatJoinRequest.mock.calls as [
      [(update: ChatJoinRequestUpdate) => Promise<void>],
    ];
    await handler({ chatId: Number(TEST_GROUP_ID), userId, inviteLink });
  };

  const chatMemberUpdate = (userId: number, status: string) => {
    statuses.set(userId, status);
    const [[handler]] = testApp.telegramBot.onChatMember.mock.calls as [
      [(update: ChatMemberUpdate) => void],
    ];
    handler({ chatId: Number(TEST_GROUP_ID), userId, status });
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: statuses.get(id) ?? 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    server = testApp.app.getHttpServer() as App;
    db = testApp.app.get<Connection>(getConnectionToken());
    await Promise.all(MEMBERS.map(authenticate));
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(() => {
    const tg = testApp.telegramBot;
    tg.approveJoinRequest.mockClear();
    tg.declineJoinRequest.mockClear();
    tg.revokeInviteLink.mockClear();
  });

  it('al aprobarse, crea un enlace con solicitud de unión, lo guarda, lo envía por DM y lo muestra en GET /me', async () => {
    anaRequestChatId = await apply(ANA);
    const tg = testApp.telegramBot;

    await voteAll(anaRequestChatId, 'approve');

    const name = anaRequestChatId.replace(/-/g, '');
    expect(tg.createAdmissionLink).toHaveBeenCalledTimes(1);
    expect(tg.createAdmissionLink).toHaveBeenCalledWith(name);
    anaLink = `https://t.me/+${name}`;
    expect((await stored(anaRequestChatId))?.inviteLink).toBe(anaLink);
    expect(tg.sendInviteLinkToUser).toHaveBeenCalledWith(ANA.id, anaLink);
    // El rol de Ana queda cacheado como solicitante.
    expect(await me(ANA)).toEqual(
      expect.objectContaining({
        role: 'applicant',
        requestChatId: anaRequestChatId,
        requestChatState: 'Approved',
        inviteLink: anaLink,
      }),
    );
  });

  it('otra cuenta con el mismo enlace es rechazada', async () => {
    await authenticate(INTRUSO);

    await joinRequest(INTRUSO.id, anaLink);

    expect(testApp.telegramBot.declineJoinRequest).toHaveBeenCalledWith(
      INTRUSO.id,
    );
    expect(testApp.telegramBot.approveJoinRequest).not.toHaveBeenCalled();
  });

  it('una cuenta que no está en la BD es rechazada', async () => {
    await joinRequest(123456, anaLink);

    expect(testApp.telegramBot.declineJoinRequest).toHaveBeenCalledWith(123456);
  });

  it('el aprobado por otro enlace es rechazado', async () => {
    await joinRequest(ANA.id, 'https://t.me/+otro-enlace');

    expect(testApp.telegramBot.declineJoinRequest).toHaveBeenCalledWith(ANA.id);
    expect((await stored(anaRequestChatId))?.admittedAt).toBeUndefined();
  });

  it('el aprobado por su enlace entra: queda marcado, el enlace se revoca y GET /me ya dice member', async () => {
    statuses.set(ANA.id, 'member');

    await joinRequest(ANA.id, anaLink);

    const tg = testApp.telegramBot;
    expect(tg.approveJoinRequest).toHaveBeenCalledWith(ANA.id);
    expect(tg.declineJoinRequest).not.toHaveBeenCalled();
    expect(tg.revokeInviteLink).toHaveBeenCalledWith(anaLink);
    expect((await stored(anaRequestChatId))?.admittedAt).toBeInstanceOf(Date);
    // Sin esperar el update chat_member ni a que venza la caché (RNF-SEG-10).
    expect((await me(ANA)).role).toBe('member');
  });

  it('si sale del grupo y vuelve con el mismo enlace, es rechazado y no recibe otro', async () => {
    chatMemberUpdate(ANA.id, 'left');

    const body = await me(ANA);
    await joinRequest(ANA.id, anaLink);

    expect(body.role).toBe('applicant');
    expect(body.requestChatState).toBe('Approved');
    expect(body).not.toHaveProperty('inviteLink');
    expect(testApp.telegramBot.declineJoinRequest).toHaveBeenCalledWith(ANA.id);
    expect(testApp.telegramBot.approveJoinRequest).not.toHaveBeenCalled();
    expect(testApp.telegramBot.createAdmissionLink).toHaveBeenCalledTimes(1);
  });

  it('un rechazado no recibe enlace y su solicitud de unión es rechazada', async () => {
    const id = await apply(BETO);
    testApp.telegramBot.createAdmissionLink.mockClear();

    await voteAll(id, 'reject');
    await joinRequest(BETO.id, anaLink);

    expect(testApp.telegramBot.createAdmissionLink).not.toHaveBeenCalled();
    expect(await me(BETO)).not.toHaveProperty('inviteLink');
    expect(testApp.telegramBot.declineJoinRequest).toHaveBeenCalledWith(
      BETO.id,
    );
  });

  it('una aprobación anterior a T25 (sin enlace guardado) no muestra enlace y no entra', async () => {
    const id = await apply(CARO);
    await db
      .collection<StoredRequestChat & { state: string }>('requestchats')
      .updateOne({ _id: new mongo.UUID(id) }, { $set: { state: 'Approved' } });

    expect(await me(CARO)).not.toHaveProperty('inviteLink');
    await joinRequest(CARO.id, `https://t.me/+${id.replace(/-/g, '')}`);

    expect(testApp.telegramBot.declineJoinRequest).toHaveBeenCalledWith(
      CARO.id,
    );
  });

  it('ignora solicitudes de unión a otros chats', async () => {
    const [[handler]] = testApp.telegramBot.onChatJoinRequest.mock.calls as [
      [(update: ChatJoinRequestUpdate) => Promise<void>],
    ];

    await handler({ chatId: -100999, userId: INTRUSO.id, inviteLink: anaLink });

    expect(testApp.telegramBot.declineJoinRequest).not.toHaveBeenCalled();
    expect(testApp.telegramBot.approveJoinRequest).not.toHaveBeenCalled();
  });
});
