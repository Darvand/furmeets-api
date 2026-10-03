import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { migrate } from '../scripts/migrations/001-request-chat-split';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBER = { id: 9951, first_name: 'Miembro' };
const ANA = { id: 9952, first_name: 'Ana' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

interface RequestChatDto {
  uuid: string;
  state: string;
  messages: { uuid: string; content: string; user: { name: string } }[];
  votes: { approved: number; rejected: number };
  legacy?: { howDidYouFindUs?: string; interests?: string };
  form?: unknown;
}

/**
 * Criterio de éxito 14: tras la migración, una solicitud creada con el código de `main`
 * (mensajes y leídos embebidos) se abre en la App con sus mensajes y votos.
 */
describe('Migración 001: la API lee lo migrado (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let db: mongo.Db;
  const chatId = new mongo.UUID();

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === MEMBER.id ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    server = testApp.app.getHttpServer() as App;
    db = testApp.app.get<Connection>(getConnectionToken()).db!;

    const [ana, member] = await Promise.all([
      authenticate(ANA),
      authenticate(MEMBER),
    ]);
    const anaId = new mongo.UUID(ana.id.value);
    const memberId = new mongo.UUID(member.id.value);
    // Como en producción: avatar con `file_path` y especie fuera del enum anterior.
    await db
      .collection<mongo.Document & { _id: mongo.UUID }>('users')
      .updateOne(
        { _id: anaId },
        { $set: { avatarUrl: 'photos/file_1.jpg', species: 'Lobo ártico' } },
      );
    await db
      .collection<mongo.Document & { _id: mongo.UUID }>('requestchats')
      .insertOne({
        _id: chatId,
        requester: anaId,
        whereYouFoundUs: 'Por un amigo',
        interests: 'Juegos de mesa',
        state: 'InProgress',
        createdAt: new Date('2025-11-01T00:00:00Z'),
        updatedAt: new Date('2025-11-01T03:00:00Z'),
        votes: [{ _id: new mongo.ObjectId(), from: memberId, type: 'approve' }],
        messages: ['hola', 'bienvenida', '¿cómo nos conociste?'].map(
          (content, i) => ({
            _id: new mongo.UUID(),
            user: i === 0 ? anaId : memberId,
            content,
            viewedBy: [{ by: memberId }],
            createdAt: new Date(`2025-11-01T0${i}:00:00Z`),
          }),
        ),
      });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('antes de migrar, la solicitud se abre sin mensajes (por eso no se despliega sin T12)', async () => {
    const res = await request(server)
      .get(`/request-chats/${chatId.toHexString(true)}`)
      .set('Authorization', tmaAuth(MEMBER))
      .expect(200);

    expect((res.body as RequestChatDto).messages).toHaveLength(0);
  });

  it('después de migrar se abre con sus mensajes, votos y respuestas del formulario anterior', async () => {
    const report = await migrate(db, { apply: true });
    expect(report.check?.ok).toBe(true);

    const res = await request(server)
      .get(`/request-chats/${chatId.toHexString(true)}`)
      .set('Authorization', tmaAuth(MEMBER))
      .expect(200);

    const chat = res.body as RequestChatDto;
    expect(chat.messages.map((m) => [m.user.name, m.content])).toEqual([
      ['Ana', 'hola'],
      ['Miembro', 'bienvenida'],
      ['Miembro', '¿cómo nos conociste?'],
    ]);
    expect(chat.votes).toEqual({ approved: 1, rejected: 0 });
    expect(chat.legacy).toEqual({
      howDidYouFindUs: 'Por un amigo',
      interests: 'Juegos de mesa',
    });
    expect(chat).not.toHaveProperty('form');
  });

  it('el listado muestra su último mensaje', async () => {
    const res = await request(server)
      .get('/request-chats')
      .set('Authorization', tmaAuth(MEMBER))
      .expect(200);

    const item = (
      res.body as {
        items: { uuid: string; lastMessage?: { content: string } }[];
      }
    ).items.find((i) => i.uuid === chatId.toHexString(true));
    expect(item?.lastMessage?.content).toBe('¿cómo nos conociste?');
  });

  it('la solicitante, con especie en texto libre, sigue entrando y abre su solicitud', async () => {
    await request(server)
      .get(`/request-chats/${chatId.toHexString(true)}`)
      .set('Authorization', tmaAuth(ANA))
      .expect(200);
    const me = await request(server)
      .get('/me')
      .set('Authorization', tmaAuth(ANA))
      .expect(200);

    expect(me.body).toMatchObject({
      role: 'applicant',
      requestChatId: chatId.toHexString(true),
    });
  });
});
