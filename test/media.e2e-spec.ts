import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { UserService } from '../src/members/application/user.service';
import { StorageNotConfiguredError } from '../src/telegram-bot/telegram-bot.service';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBER = { id: 9001, first_name: 'Mia' };
const APPLICANT_A = { id: 9002, first_name: 'Ana' };
const APPLICANT_B = { id: 9003, first_name: 'Beto' };

const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = {
  id: Number(TEST_GROUP_ID),
  type: 'supergroup',
  title: 'FurMeets',
  photo: {
    small_file_id: 'group-small',
    small_file_unique_id: 'group-small-u',
    big_file_id: 'group-big',
    big_file_unique_id: 'group-big-u',
  },
};

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('jpeg de prueba'),
]);
/** Lo que "devuelve" Telegram al descargar cualquier archivo en esta prueba. */
const TELEGRAM_BYTES = 'bytes servidos por Telegram';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Media: subida y proxy /media/:id (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let uploads = 0;

  const auth = (user: TelegramInitDataUser) => tmaAuth(user);

  const upload = (user: TelegramInitDataUser, bytes = JPEG) =>
    request(server)
      .post('/media')
      .set('Authorization', auth(user))
      .attach('file', bytes, {
        filename: 'fursona.jpg',
        contentType: 'image/jpeg',
      });

  const download = (user: TelegramInitDataUser, id: string) =>
    request(server).get(`/media/${id}`).set('Authorization', auth(user));

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === MEMBER.id ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    tg.getProfilePhoto.mockImplementation((telegramId: number) =>
      Promise.resolve({
        file_id: `avatar-${telegramId}`,
        file_unique_id: `avatar-${telegramId}-u`,
        width: 160,
        height: 160,
      }),
    );
    tg.uploadPhotoToStorage.mockImplementation(() => {
      uploads += 1;
      return Promise.resolve({
        file_id: `upload-${uploads}`,
        file_unique_id: `upload-${uploads}-u`,
        width: 1280,
        height: 1280,
      });
    });
    tg.getFilePath.mockImplementation((fileId: string) =>
      Promise.resolve(`photos/${fileId}.jpg`),
    );
    tg.downloadFile.mockImplementation(() =>
      Promise.resolve(
        new Response(TELEGRAM_BYTES, {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
    );
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('sin auth', () => {
    it('GET /media/:id → 401', async () => {
      await request(server).get(`/media/${UNKNOWN_ID}`).expect(401);
    });

    it('POST /media → 401 sin subir nada a Telegram', async () => {
      await request(server)
        .post('/media')
        .attach('file', JPEG, 'fursona.jpg')
        .expect(401);
      expect(testApp.telegramBot.uploadPhotoToStorage).not.toHaveBeenCalled();
    });
  });

  describe('imágenes subidas', () => {
    let id: string;

    beforeAll(async () => {
      const res = await upload(APPLICANT_A).expect(201);
      id = (res.body as { id: string }).id;
    });

    it('la subida guarda en Telegram y devuelve solo un id', () => {
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const [[bytes]] = testApp.telegramBot.uploadPhotoToStorage.mock.calls as [
        [Buffer],
      ];
      expect(bytes.equals(JPEG)).toBe(true);
    });

    it('quien la subió la descarga con caché privada de un día', async () => {
      const res = await download(APPLICANT_A, id).buffer(true).expect(200);

      expect(res.body).toEqual(Buffer.from(TELEGRAM_BYTES));
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('private, max-age=86400');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(testApp.telegramBot.getFilePath).toHaveBeenCalledWith('upload-1');
    });

    it('otro solicitante → 403, sin descargar de Telegram ni cachear', async () => {
      testApp.telegramBot.downloadFile.mockClear();

      const res = await download(APPLICANT_B, id).expect(403);

      expect(res.headers['cache-control']).not.toBe('private, max-age=86400');
      expect(testApp.telegramBot.downloadFile).not.toHaveBeenCalled();
    });

    it('un miembro la ve', async () => {
      await download(MEMBER, id).expect(200);
    });
  });

  describe('validación de la subida', () => {
    it('lo que no es JPEG, PNG ni WebP → 400 aunque diga image/jpeg', async () => {
      await upload(APPLICANT_A, Buffer.from('GIF89a falso')).expect(400);
    });

    it('más de 10 MB → 413', async () => {
      const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
      await upload(APPLICANT_A, big).expect(413);
    });

    it('sin archivo → 400', async () => {
      await request(server)
        .post('/media')
        .set('Authorization', auth(APPLICANT_A))
        .expect(400);
    });

    it('sin canal de almacenamiento → 503', async () => {
      testApp.telegramBot.uploadPhotoToStorage.mockRejectedValueOnce(
        new StorageNotConfiguredError(),
      );
      await upload(APPLICANT_A).expect(503);
    });
  });

  describe('ids', () => {
    it('id con formato inválido → 400', async () => {
      await download(APPLICANT_A, 'no-es-uuid').expect(400);
    });

    it('id inexistente → 404', async () => {
      await download(MEMBER, UNKNOWN_ID).expect(404);
    });
  });

  describe('avatares y foto del grupo', () => {
    let avatarMediaId: string;
    let photoMediaId: string;

    beforeAll(async () => {
      // Lo que hace la sincronización en segundo plano tras `GET /me`.
      const mia = await testApp.app
        .get(InitDataAuthService)
        .authenticate(signInitData(MEMBER, TEST_BOT_TOKEN));
      await testApp.app.get(UserService).refreshAvatar(mia);
      await request(server)
        .post('/groups/sync')
        .set('Authorization', auth(MEMBER))
        .expect(201);

      const me = await request(server)
        .get('/me')
        .set('Authorization', auth(MEMBER))
        .expect(200);
      avatarMediaId = (me.body as { user: { avatarMediaId: string } }).user
        .avatarMediaId;
      const group = await request(server)
        .get('/groups')
        .set('Authorization', auth(MEMBER))
        .expect(200);
      photoMediaId = (group.body as { photoMediaId: string }).photoMediaId;
    });

    it('los usuarios guardan el id de media del avatar, no un file_path', () => {
      expect(avatarMediaId).toMatch(/^[0-9a-f-]{36}$/);
      expect(photoMediaId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('un solicitante ve el avatar de un miembro y la foto del grupo', async () => {
      await download(APPLICANT_A, avatarMediaId).expect(200);
      await download(APPLICANT_A, photoMediaId).expect(200);
      expect(testApp.telegramBot.getFilePath).toHaveBeenCalledWith(
        `avatar-${MEMBER.id}`,
      );
      expect(testApp.telegramBot.getFilePath).toHaveBeenCalledWith(
        'group-small',
      );
    });

    it('resincronizar el mismo avatar no crea otro registro', async () => {
      const mia = await testApp.app
        .get(InitDataAuthService)
        .authenticate(signInitData(MEMBER, TEST_BOT_TOKEN));
      await testApp.app.get(UserService).refreshAvatar(mia);

      expect(mia.avatarMediaId).toBe(avatarMediaId);
    });

    it('ninguna respuesta lleva URLs de archivos de Telegram (RNF-SEG-03)', async () => {
      for (const path of ['/me', '/groups', `/users/${MEMBER.id}`]) {
        const res = await request(server)
          .get(path)
          .set('Authorization', auth(MEMBER))
          .expect(200);
        expect(JSON.stringify(res.body)).not.toContain('api.telegram.org');
        expect(JSON.stringify(res.body)).not.toContain(TEST_BOT_TOKEN);
      }
    });
  });
});
