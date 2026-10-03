import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
// Después de `./helpers/app` (que carga AppModule): importado antes, el ciclo
// ChatService ↔ ChatGateway (`forwardRef`) deja una clase sin definir y Nest no arranca.
import { ChatService } from '../src/chat/application/chat.service';
import { UserEntity } from '../src/members/domain/entities/user.entity';
import { UUID } from '../src/shared/domain/value-objects/uuid.value-object';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBERS = Array.from({ length: 4 }, (_, i) => ({
  id: 9501 + i,
  first_name: `Miembro ${i + 1}`,
}));
const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));
const APPLICANTS = Array.from({ length: 5 }, (_, i) => ({
  id: 9601 + i,
  first_name: `Solicitante ${i + 1}`,
}));
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface ItemDto {
  uuid: string;
  requester: { uuid: string; name: string };
  lastMessage?: { from: { name: string }; content: string; at: string };
  unreadMessagesCount: number;
  state: string;
  votes: { approved: number; rejected: number };
  userVote?: string;
  createdAt: string;
}

interface ListDto {
  items: ItemDto[];
  nextCursor?: string;
}

describe('Listado liviano de solicitudes (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  const users = new Map<number, UserEntity>();
  /** Solicitudes creadas, de la más antigua a la más reciente. */
  const created: string[] = [];

  const authenticate = async (user: TelegramInitDataUser) => {
    const entity = await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));
    users.set(user.id, entity);
    return entity;
  };

  const list = async (
    viewer: TelegramInitDataUser,
    query: Record<string, string | number> = {},
  ) =>
    (
      await request(server)
        .get('/request-chats')
        .query(query)
        .set('Authorization', tmaAuth(viewer))
        .expect(200)
    ).body as ListDto;

  const item = async (viewer: TelegramInitDataUser, uuid: string) =>
    (await list(viewer)).items.find((i) => i.uuid === uuid)!;

  const send = (from: TelegramInitDataUser, uuid: string, content: string) =>
    testApp.app
      .get(ChatService)
      .addMessageToRequestChat(UUID.from(uuid), users.get(from.id)!, content);

  const vote = (
    member: TelegramInitDataUser,
    uuid: string,
    type: 'approve' | 'reject',
  ) =>
    request(server)
      .put(`/request-chats/${uuid}/vote/${type}`)
      .set('Authorization', tmaAuth(member))
      .expect(200);

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: MEMBER_IDS.has(id) ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    server = testApp.app.getHttpServer() as App;
    await Promise.all(MEMBERS.map(authenticate));
    for (const applicant of APPLICANTS) {
      const entity = await authenticate(applicant);
      const res = await request(server)
        .post('/request-chats')
        .set('Authorization', tmaAuth(applicant))
        .send({ requesterUUID: entity.id.value })
        .expect(201);
      created.push((res.body as { uuid: string }).uuid);
    }
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('cada solicitud trae solo su resumen: sin mensajes, leídos ni votos', async () => {
    const [newest] = created.slice(-1);
    await send(APPLICANTS[4], newest, 'hola, soy yo');
    await vote(MEMBERS[0], newest, 'approve');
    await vote(MEMBERS[1], newest, 'reject');
    await vote(MEMBERS[2], newest, 'reject');

    const body = await list(MEMBERS[0]);
    const summary = body.items.find((i) => i.uuid === newest)!;

    expect(Object.keys(summary).sort()).toEqual(
      [
        'uuid',
        'requester',
        'lastMessage',
        'unreadMessagesCount',
        'state',
        'votes',
        'userVote',
        'createdAt',
      ].sort(),
    );
    expect(summary.votes).toEqual({ approved: 1, rejected: 2 });
    expect(summary.lastMessage).toMatchObject({
      content: 'hola, soy yo',
      from: { name: 'Solicitante 5' },
    });
    expect(summary.lastMessage!.at).toMatch(ISO_UTC);
    expect(summary.createdAt).toMatch(ISO_UTC);
    for (const listed of body.items) {
      expect(listed).not.toHaveProperty('messages');
      expect(listed).not.toHaveProperty('readBy');
      expect(Array.isArray(listed.votes)).toBe(false);
    }
  });

  it('de los votos solo expone conteos y el voto propio, nunca quién votó (RNF-PRI-01)', async () => {
    const [newest] = created.slice(-1);
    const voters = [MEMBERS[0], MEMBERS[1], MEMBERS[2]].map(
      (m) => users.get(m.id)!.id.value,
    );

    const raw = JSON.stringify(await list(MEMBERS[3]));
    for (const voter of voters) {
      expect(raw).not.toContain(voter);
    }
    expect((await item(MEMBERS[3], newest)).userVote).toBeUndefined();
    expect((await item(MEMBERS[0], newest)).userVote).toBe('approve');
    expect((await item(MEMBERS[1], newest)).userVote).toBe('reject');
  });

  it('cuenta los no leídos de quien mira, y bajan al marcarlos leídos', async () => {
    const [oldest] = created;
    await send(APPLICANTS[0], oldest, 'uno');
    await send(APPLICANTS[0], oldest, 'dos');

    // Bienvenida del bot + 2 del solicitante.
    expect((await item(MEMBERS[3], oldest)).unreadMessagesCount).toBe(3);
    // Lo que escribe quien mira no cuenta como no leído.
    await send(MEMBERS[3], oldest, 'hola');
    expect((await item(MEMBERS[3], oldest)).unreadMessagesCount).toBe(3);

    await request(server)
      .post(`/request-chats/${oldest}/read`)
      .set('Authorization', tmaAuth(MEMBERS[3]))
      .expect(204);
    expect((await item(MEMBERS[3], oldest)).unreadMessagesCount).toBe(0);
    expect((await item(MEMBERS[2], oldest)).unreadMessagesCount).toBe(4);
  });

  it('el contador de no leídos tiene tope 100 ("100 o más")', async () => {
    const chat = created[1];
    for (let i = 0; i < 100; i++) {
      await send(APPLICANTS[1], chat, `mensaje ${i}`);
    }

    // Bienvenida + 100 mensajes = 101 sin leer.
    expect((await item(MEMBERS[0], chat)).unreadMessagesCount).toBe(100);
    await request(server)
      .post(`/request-chats/${chat}/read`)
      .set('Authorization', tmaAuth(MEMBERS[0]))
      .expect(204);
    await send(APPLICANTS[1], chat, 'uno más');
    expect((await item(MEMBERS[0], chat)).unreadMessagesCount).toBe(1);
  });

  it('pagina de la más reciente a la más antigua, sin repetir ni saltar', async () => {
    const pages: ListDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(MEMBERS[0], {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor);

    const paged = pages.flatMap((p) => p.items);
    expect(pages.map((p) => p.items.length)).toEqual([2, 2, 1]);
    expect(pages.at(-1)).not.toHaveProperty('nextCursor');
    // Mismo orden que en una sola página; si dos comparten fecha, desempata el id.
    expect(paged.map((i) => i.uuid)).toEqual(
      (await list(MEMBERS[0])).items.map((i) => i.uuid),
    );
    expect(new Set(paged.map((i) => i.uuid))).toEqual(new Set(created));
    const times = paged.map((i) => Date.parse(i.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it.each([
    ['limit=0', { limit: 0 }],
    ['limit=101', { limit: 101 }],
    ['limit no numérico', { limit: 'diez' }],
    ['cursor ajeno', { cursor: 'no-es-un-cursor' }],
    ['parámetro desconocido', { page: 2 }],
  ])('rechaza %s con 400', async (_, query) => {
    await request(server)
      .get('/request-chats')
      .query(query)
      .set('Authorization', tmaAuth(MEMBERS[0]))
      .expect(400);
  });
});
