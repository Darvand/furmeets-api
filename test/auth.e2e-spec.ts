import { getModelToken } from '@nestjs/mongoose';
import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { GroupsService } from '../src/members/application/groups.service';
import { User } from '../src/members/infraestructure/schemas/user.schema';
import { createTestApp, TEST_BOT_TOKEN, TestApp, tmaAuth } from './helpers/app';
import { signInitData } from './helpers/init-data';

const DAY_MS = 24 * 60 * 60 * 1000;
const AVATAR_MEDIA_ID = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';

describe('Autenticación HTTP por initData (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let users: Model<User>;

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
    users = testApp.app.get<Model<User>>(getModelToken(User.name));
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(async () => {
    await users.deleteMany({});
  });

  it('GET / es pública (keep-alive)', async () => {
    await request(server).get('/').expect(200);
  });

  describe('rechaza con 401', () => {
    const user = { id: 3001, first_name: 'Ana' };

    it('sin header Authorization', async () => {
      await request(server).get('/request-chats').expect(401);
    });

    it('con otro esquema que no es tma', async () => {
      const initData = signInitData(user, TEST_BOT_TOKEN);
      await request(server)
        .get('/request-chats')
        .set('Authorization', `Bearer ${initData}`)
        .expect(401);
    });

    it('con firma inválida', async () => {
      await request(server)
        .get('/request-chats')
        .set('Authorization', `tma ${signInitData(user, 'otro:token')}`)
        .expect(401);
    });

    it('con usuario alterado después de firmar', async () => {
      const params = new URLSearchParams(signInitData(user, TEST_BOT_TOKEN));
      params.set('user', JSON.stringify({ ...user, id: 9999 }));
      await request(server)
        .get('/request-chats')
        .set('Authorization', `tma ${params.toString()}`)
        .expect(401);
    });

    it('con auth_date de hace más de 24 h', async () => {
      const authDate = new Date(Date.now() - DAY_MS - 60_000);
      await request(server)
        .get('/request-chats')
        .set('Authorization', tmaAuth(user, { authDate }))
        .expect(401);
    });

    it('solo con x-telegram-id, aunque el usuario exista', async () => {
      await request(server)
        .get(`/users/${user.id}`)
        .set('Authorization', tmaAuth(user))
        .expect(200);

      await request(server)
        .get(`/users/${user.id}`)
        .set('x-telegram-id', String(user.id))
        .expect(401);
    });

    it('sin crear al usuario en BD', async () => {
      await request(server)
        .get('/request-chats')
        .set('Authorization', `tma ${signInitData(user, 'otro:token')}`)
        .expect(401);

      expect(await users.countDocuments()).toBe(0);
    });

    it('y registra el motivo en warn sin el initData', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const initData = signInitData(user, 'otro:token');

      await request(server)
        .get('/request-chats')
        .set('Authorization', `tma ${initData}`)
        .expect(401);

      const logged = warn.mock.calls.map((args) => String(args[0])).join('\n');
      warn.mockRestore();
      expect(logged).toContain('invalid-signature');
      expect(logged).not.toContain(new URLSearchParams(initData).get('hash')!);
    });
  });

  describe('con initData válido', () => {
    it('crea al usuario a partir de initData y lo usa en la ruta', async () => {
      const res = await request(server)
        .get('/users/4001')
        .set(
          'Authorization',
          tmaAuth({
            id: 4001,
            first_name: 'Beto',
            last_name: 'Pérez',
            username: 'beto',
            photo_url: 'https://t.me/i/userpic/320/beto.jpg',
          }),
        )
        .expect(200);

      expect(res.body).toMatchObject({
        telegramId: 4001,
        name: 'Beto Pérez',
        username: 'beto',
      });
      // La foto de initData no se guarda: el avatar es un id de `media` (RNF-SEG-03).
      expect(res.body).not.toHaveProperty('avatarMediaId');
      const stored = await users.findOne({ telegramId: 4001 }).lean();
      expect(stored).toMatchObject({ name: 'Beto Pérez', isMember: false });
    });

    it('actualiza nombre y usuario sin duplicar ni tocar el resto', async () => {
      await request(server)
        .get('/users/4002')
        .set(
          'Authorization',
          tmaAuth({ id: 4002, first_name: 'Caro', username: 'caro' }),
        )
        .expect(200);
      await users.updateOne(
        { telegramId: 4002 },
        { isMember: true, species: 'Wolf', avatarMediaId: AVATAR_MEDIA_ID },
      );
      const { _id } = (await users.findOne({ telegramId: 4002 }).lean())!;

      const res = await request(server)
        .get('/users/4002')
        .set(
          'Authorization',
          tmaAuth({
            id: 4002,
            first_name: 'Carolina',
            photo_url: 'https://t.me/otra.jpg',
          }),
        )
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Carolina',
        species: 'Wolf',
        avatarMediaId: AVATAR_MEDIA_ID,
      });
      expect(res.body).not.toHaveProperty('username');
      const stored = await users.find({ telegramId: 4002 }).lean();
      expect(stored).toHaveLength(1);
      expect(String(stored[0]._id)).toBe(String(_id));
      expect(stored[0].isMember).toBe(true);
    });

    it('la identidad sale del initData, no de la ruta: POST /groups/sync sincroniza al usuario autenticado', async () => {
      const sync = jest
        .spyOn(testApp.app.get(GroupsService), 'sync')
        .mockResolvedValue(true);

      await request(server)
        .post('/groups/sync')
        .set('Authorization', tmaAuth({ id: 4003, first_name: 'Dani' }))
        .set('x-telegram-id', '1')
        .expect(201);

      expect(sync).toHaveBeenCalledWith(
        expect.objectContaining({ telegramId: 4003 }),
      );
      sync.mockRestore();
    });

    it('POST /users ya no existe', async () => {
      await request(server)
        .post('/users')
        .set('Authorization', tmaAuth({ id: 4004, first_name: 'Eva' }))
        .send({ telegramId: 5, name: 'Otro' })
        .expect(404);
    });
  });
});
