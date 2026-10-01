import { randomUUID } from 'crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp, TestApp, tmaAuth } from './helpers/app';

describe('App (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  const auth = tmaAuth({ id: 1001, first_name: 'Ana' });

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
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

    it('POST /request-chats con campos no declarados en el DTO → 400', async () => {
      const res = await request(server)
        .post('/request-chats')
        .set('Authorization', auth)
        .send({ requesterUUID: randomUUID(), isAdmin: true })
        .expect(400);

      expect((res.body as { message: string[] }).message).toEqual(
        expect.arrayContaining(['property isAdmin should not exist']),
      );
    });

    it('POST /request-chats con tipos inválidos → 400', async () => {
      await request(server)
        .post('/request-chats')
        .set('Authorization', auth)
        .send({ requesterUUID: 123, interests: ['a'] })
        .expect(400);
    });
  });

  // Los payloads que hoy envía la mini-app siguen pasando la validación.
  describe('payloads válidos pasan el ValidationPipe', () => {
    it('PUT /request-chats/:id/vote/approve llega al servicio (404: no existe)', async () => {
      await request(server)
        .put(`/request-chats/${randomUUID()}/vote/approve`)
        .set('Authorization', auth)
        .expect(404);
    });

    it('POST /request-chats con el body de la mini-app llega al servicio (404: requester no existe)', async () => {
      await request(server)
        .post('/request-chats')
        .set('Authorization', auth)
        .send({ requesterUUID: randomUUID(), interests: 'furros' })
        .expect(404);
    });
  });
});
