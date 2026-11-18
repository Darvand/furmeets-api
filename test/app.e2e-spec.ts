import { randomUUID } from 'crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestApp, tmaAuth } from './helpers/app';

describe('App (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  const MEMBER_ID = 1001;
  /** Ana es miembro (puede votar). */
  const auth = tmaAuth({ id: MEMBER_ID, first_name: 'Ana' });
  /** Beto es solicitante (puede crear su solicitud). */
  const applicantAuth = tmaAuth({ id: 1002, first_name: 'Beto' });

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === MEMBER_ID ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue({
      id: 999,
      is_bot: true,
      first_name: 'FurBot',
    });
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('usa la BD en memoria, no la de desarrollo', () => {
    const connection = testApp.app.get<Connection>(getConnectionToken());
    const memoryUri = new URL(testApp.mongo.getUri());

    expect(`${connection.host}:${connection.port}`).toBe(memoryUri.host);
    expect(connection.name).toBe('furmeets-test');
  });

  it('GET / → 200', async () => {
    await request(server).get('/').expect(200).expect({ status: 'ok' });
  });

  describe('validación', () => {
    it('PUT /request-chats/:id/vote/:type con un tipo inválido → 400', async () => {
      const res = await request(server)
        .put(`/request-chats/${randomUUID()}/vote/maybe`)
        .set('Authorization', auth)
        .expect(400);

      expect((res.body as { message: string[] }).message).toEqual(
        expect.arrayContaining([expect.stringContaining('type')]),
      );
    });

    it('POST /applications con campos no declarados en el DTO → 400', async () => {
      const res = await request(server)
        .post('/applications')
        .set('Authorization', applicantAuth)
        .send({ age: 25, city: 'Bogotá', isAdmin: true })
        .expect(400);

      expect((res.body as { message: string[] }).message).toEqual(
        expect.arrayContaining(['property isAdmin should not exist']),
      );
    });

    it('POST /applications con tipos inválidos → 400', async () => {
      await request(server)
        .post('/applications')
        .set('Authorization', applicantAuth)
        .send({ age: 'veinte', city: ['Bogotá'] })
        .expect(400);
    });
  });

  it('POST /request-chats (formulario anterior) ya no existe → 404', async () => {
    await request(server)
      .post('/request-chats')
      .set('Authorization', applicantAuth)
      .send({ interests: 'furros' })
      .expect(404);
  });

  // Los payloads que hoy envía la mini-app siguen pasando la validación.
  describe('payloads válidos pasan el ValidationPipe', () => {
    it('PUT /request-chats/:id/vote/approve llega al servicio (404: no existe)', async () => {
      await request(server)
        .put(`/request-chats/${randomUUID()}/vote/approve`)
        .set('Authorization', auth)
        .expect(404);
    });

    it('POST /applications con el body de la mini-app crea la solicitud del solicitante', async () => {
      await request(server)
        .post('/applications')
        .set('Authorization', applicantAuth)
        .send({
          imageIds: [],
          age: 25,
          city: 'Bogotá',
          species: 'Zorro ártico',
          howDidYouFindUs: 'Por un amigo',
        })
        .expect(201);
    });
  });
});
