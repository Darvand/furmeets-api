import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { countSeeded, deleteSeed, seed } from '../scripts/seed/seed-data';
import { createTestApp, TEST_GROUP_ID, TestApp, tmaAuth } from './helpers/app';

const MEMBER = { id: 9101, first_name: 'Mia' };
const SMALL = {
  members: 6,
  inProgress: 2,
  approved: 2,
  rejected: 1,
  minMessages: 3,
  maxMessages: 6,
  seed: 7,
};

type ListBody = {
  items: { uuid: string; state: string; unreadMessagesCount: number }[];
};

/**
 * El script de datos de staging escribe directo en Mongo: esta prueba asegura que la API
 * sigue leyendo lo que siembra (mismos schemas) y que borrar solo quita lo sembrado.
 */
describe('Datos de staging (scripts/seed) (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let connection: Connection;
  const messages = () => connection.db!.collection('requestchatmessages');
  const auth = tmaAuth(MEMBER);

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
    connection = testApp.app.get<Connection>(getConnectionToken());
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockResolvedValue({ status: 'member' });
    tg.getBotInfo.mockResolvedValue({
      id: 999,
      is_bot: true,
      first_name: 'FurBot',
    });
    tg.getGroup.mockResolvedValue({
      id: Number(TEST_GROUP_ID),
      type: 'supergroup',
    });
    // El primer GET /me crea el grupo y registra al miembro real.
    await request(server).get('/me').set('Authorization', auth).expect(200);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('siembra usuarios, solicitudes, mensajes y votos y agrega los miembros al grupo', async () => {
    const result = await seed(connection.db!, SMALL);

    expect(result).toMatchObject({
      users: 6 + 5,
      requestChats: 5,
      addedToGroup: true,
    });
    expect(result.messages).toBeGreaterThanOrEqual(5 * 3);
    // Los mensajes van en su propia colección, no dentro de la solicitud.
    expect(await messages().countDocuments()).toBe(result.messages);
    const chat = await connection.db!.collection('requestchats').findOne({});
    expect(chat).not.toHaveProperty('messages');
  });

  it('la API lista las solicitudes sembradas con su último mensaje y no leídos', async () => {
    const res = await request(server)
      .get('/request-chats')
      .set('Authorization', auth)
      .expect(200);
    const { items } = res.body as ListBody;

    expect(items).toHaveLength(5);
    expect(items.map((item) => item.state).sort()).toEqual([
      'Approved',
      'Approved',
      'InProgress',
      'InProgress',
      'Rejected',
    ]);
    // El miembro real no leyó nada sembrado.
    expect(items.every((item) => item.unreadMessagesCount > 0)).toBe(true);
  });

  it('la API abre una solicitud sembrada y permite votar sin cerrarla', async () => {
    const list = await request(server)
      .get('/request-chats')
      .set('Authorization', auth);
    const inProgress = (list.body as ListBody).items.find(
      (item) => item.state === 'InProgress',
    )!;

    const chat = await request(server)
      .get(`/request-chats/${inProgress.uuid}`)
      .set('Authorization', auth)
      .expect(200);
    expect(
      (chat.body as { messages: unknown[] }).messages.length,
    ).toBeGreaterThanOrEqual(3);

    const vote = await request(server)
      .put(`/request-chats/${inProgress.uuid}/vote/approve`)
      .set('Authorization', auth)
      .expect(200);
    expect((vote.body as { state: string }).state).toBe('InProgress');
  });

  it('el grupo muestra a los miembros sembrados', async () => {
    const res = await request(server)
      .get('/groups')
      .set('Authorization', auth)
      .expect(200);

    // 6 miembros + 2 aprobados + el miembro real.
    expect((res.body as { members: unknown[] }).members).toHaveLength(9);
  });

  it('borrar quita solo lo sembrado y se puede volver a sembrar igual', async () => {
    const deleted = await deleteSeed(connection.db!);

    expect(deleted).toEqual({ users: 11, requestChats: 5 });
    expect(await countSeeded(connection.db!)).toBe(0);
    expect(await messages().countDocuments()).toBe(0);
    const group = await request(server)
      .get('/groups')
      .set('Authorization', auth);
    expect((group.body as { members: unknown[] }).members).toHaveLength(1);
    await request(server)
      .get(`/users/${MEMBER.id}`)
      .set('Authorization', auth)
      .expect(200);

    const again = await seed(connection.db!, SMALL);
    expect(again.users).toBe(11);
  });
});
