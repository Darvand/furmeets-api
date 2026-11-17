import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
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
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBERS = Array.from({ length: 5 }, (_, i) => ({
  id: 9701 + i,
  first_name: `Miembro ${i + 1}`,
}));
const MEMBER_IDS = new Set(MEMBERS.map((m) => m.id));
/** Dos aprobadas, una rechazada y tres en curso. */
const APPLICANTS = Array.from({ length: 6 }, (_, i) => ({
  id: 9801 + i,
  first_name: `Solicitante ${i + 1}`,
}));
const OUTSIDER = { id: 9899, first_name: 'Sin solicitud' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

interface ListDto {
  items: { uuid: string; state: string; createdAt: string }[];
  nextCursor?: string;
  totals: {
    total: number;
    inProgress: number;
    approved: number;
    rejected: number;
  };
  thresholds: { approve: number; reject: number };
}

describe('Inicio de miembros: totales y filtro del listado (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let db: Connection;
  /** Solicitudes creadas, de la más antigua a la más reciente. */
  const created: string[] = [];

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  const list = async (query: Record<string, string | number> = {}) =>
    (
      await request(server)
        .get('/request-chats')
        .query(query)
        .set('Authorization', tmaAuth(MEMBERS[0]))
        .expect(200)
    ).body as ListDto;

  /** Cierra la solicitud como lo hace la API: con los votos que cruzan el umbral. */
  const closeByVotes = async (uuid: string, type: 'approve' | 'reject') => {
    for (const member of MEMBERS) {
      await request(server)
        .put(`/request-chats/${uuid}/vote/${type}`)
        .set('Authorization', tmaAuth(member))
        .expect(200);
    }
  };

  /** Lo que hay en la BD, contado sin pasar por el código que se prueba. */
  const countInDb = (state?: string) =>
    db.collection('requestchats').countDocuments(state ? { state } : {});

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: MEMBER_IDS.has(id) ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    server = testApp.app.getHttpServer() as App;
    db = testApp.app.get<Connection>(getConnectionToken());
    await Promise.all(MEMBERS.map(authenticate));
    await authenticate(OUTSIDER);
    for (const applicant of APPLICANTS) {
      await authenticate(applicant);
      const res = await request(server)
        .post('/applications')
        .set('Authorization', tmaAuth(applicant))
        .send({ age: 25, city: 'Bogotá' })
        .expect(201);
      created.push((res.body as { uuid: string }).uuid);
    }
    await closeByVotes(created[0], 'approve');
    await closeByVotes(created[2], 'approve');
    await closeByVotes(created[4], 'reject');
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('los totales coinciden con los conteos por estado en la BD', async () => {
    const { totals } = await list();

    expect(totals).toEqual({
      total: 6,
      inProgress: 3,
      approved: 2,
      rejected: 1,
    });
    expect(totals).toEqual({
      total: await countInDb(),
      inProgress: await countInDb('InProgress'),
      approved: await countInDb('Approved'),
      rejected: await countInDb('Rejected'),
    });
  });

  it('los totales no dependen de la página ni del filtro', async () => {
    const all = (await list()).totals;
    const firstPage = await list({ limit: 1 });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.totals).toEqual(all);
    expect(
      (await list({ limit: 1, cursor: firstPage.nextCursor! })).totals,
    ).toEqual(all);
    expect((await list({ scope: 'open' })).totals).toEqual(all);
    expect((await list({ scope: 'closed', limit: 1 })).totals).toEqual(all);
  });

  it('trae los umbrales vigentes, para mostrar "4/5 a favor"', async () => {
    expect((await list()).thresholds).toEqual({ approve: 5, reject: 5 });
  });

  it('scope=open trae solo las que siguen en curso, de la más reciente a la más antigua', async () => {
    const { items } = await list({ scope: 'open' });

    expect(items.map((i) => i.uuid)).toEqual([
      created[5],
      created[3],
      created[1],
    ]);
    expect(new Set(items.map((i) => i.state))).toEqual(new Set(['InProgress']));
  });

  it('scope=closed trae el historial: aprobadas y rechazadas', async () => {
    const { items } = await list({ scope: 'closed' });

    expect(items.map((i) => i.uuid)).toEqual([
      created[4],
      created[2],
      created[0],
    ]);
    expect(items.map((i) => i.state)).toEqual([
      'Rejected',
      'Approved',
      'Approved',
    ]);
  });

  it('sin scope sigue trayendo todas', async () => {
    const { items } = await list();

    expect(items.map((i) => i.uuid)).toEqual([...created].reverse());
  });

  it('pagina el historial sin repetir, saltar ni mezclar las que siguen en curso', async () => {
    const pages: ListDto[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({
        scope: 'closed',
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor);

    expect(pages.map((p) => p.items.length)).toEqual([2, 1]);
    expect(pages.flatMap((p) => p.items).map((i) => i.uuid)).toEqual([
      created[4],
      created[2],
      created[0],
    ]);
  });

  it('una solicitud que se cierra pasa de en curso al historial y cambia los totales', async () => {
    // Directo en la BD: el listado solo lee el estado guardado.
    const uuid = created[1];
    await db
      .collection<{ _id: mongo.UUID }>('requestchats')
      .updateOne(
        { _id: new mongo.UUID(uuid) },
        { $set: { state: 'Rejected' } },
      );

    const open = await list({ scope: 'open' });
    const closed = await list({ scope: 'closed' });

    expect(open.items.map((i) => i.uuid)).not.toContain(uuid);
    expect(closed.items.map((i) => i.uuid)).toContain(uuid);
    expect(open.totals).toEqual({
      total: 6,
      inProgress: 2,
      approved: 2,
      rejected: 2,
    });
  });

  it('un miembro recibe la fecha de la solicitud, la misma del listado (T24)', async () => {
    const [listed] = (await list({ scope: 'open' })).items;

    const res = await request(server)
      .get(`/request-chats/${listed.uuid}`)
      .set('Authorization', tmaAuth(MEMBERS[0]))
      .expect(200);

    expect((res.body as { createdAt: string }).createdAt).toBe(
      listed.createdAt,
    );
  });

  it('rechaza un scope desconocido con 400', async () => {
    await request(server)
      .get('/request-chats')
      .query({ scope: 'Approved' })
      .set('Authorization', tmaAuth(MEMBERS[0]))
      .expect(400);
  });

  it('quien no es miembro no ve ni los totales: 403', async () => {
    const res = await request(server)
      .get('/request-chats')
      .query({ scope: 'open' })
      .set('Authorization', tmaAuth(OUTSIDER))
      .expect(403);

    expect(res.body).not.toHaveProperty('totals');
  });
});
