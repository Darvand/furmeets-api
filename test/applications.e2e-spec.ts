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

const MEMBER = { id: 9901, first_name: 'Miembro' };
const ANA = { id: 9902, first_name: 'Ana' };
const BETO = { id: 9903, first_name: 'Beto' };
const CECI = { id: 9904, first_name: 'Ceci' };
const DANI = { id: 9905, first_name: 'Dani' };
const EVA = { id: 9906, first_name: 'Eva' };
const FER = { id: 9907, first_name: 'Fer' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };

const FORM = { age: 16, city: 'Bogotá' };
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('fursona de prueba'),
]);
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

interface RequestChatDto {
  uuid: string;
  state: string;
  requester: { uuid: string; name: string };
  messages: unknown[];
  form?: Record<string, unknown> & { isMinor: boolean; imageIds?: string[] };
}

describe('Formulario de solicitud: POST /applications (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let db: Connection;

  const authenticate = (user: TelegramInitDataUser) =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  const apply = (user: TelegramInitDataUser, body: object) =>
    request(server)
      .post('/applications')
      .set('Authorization', tmaAuth(user))
      .send(body);

  const upload = async (user: TelegramInitDataUser): Promise<string> => {
    const res = await request(server)
      .post('/media')
      .set('Authorization', tmaAuth(user))
      .attach('file', JPEG, {
        filename: 'fursona.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  const download = (user: TelegramInitDataUser, id: string) =>
    request(server).get(`/media/${id}`).set('Authorization', tmaAuth(user));

  const chatsOf = async (user: TelegramInitDataUser) => {
    const entity = await authenticate(user);
    return db
      .collection('requestchats')
      .countDocuments({ requester: new mongo.UUID(entity.id.value) });
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === MEMBER.id ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    let uploads = 0;
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
      Promise.resolve(new Response('bytes de la fursona')),
    );
    server = testApp.app.getHttpServer() as App;
    db = testApp.app.get<Connection>(getConnectionToken());
    await Promise.all(
      [MEMBER, ANA, BETO, CECI, DANI, EVA, FER].map(authenticate),
    );
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('crea la solicitud del usuario autenticado, con su formulario y la etiqueta de menor', async () => {
    const beto = await authenticate(BETO);

    const res = await apply(ANA, {
      ...FORM,
      // De otro usuario: se ignora, el solicitante es siempre quien está autenticado.
      requesterUUID: beto.id.value,
      fursonaName: '  Kiba ',
      species: 'Lobo',
      howDidYouFindUs: 'Por Instagram',
    }).expect(201);

    const chat = res.body as RequestChatDto;
    expect(chat.requester.name).toBe('Ana');
    expect(chat.state).toBe('InProgress');
    expect(chat.messages).toHaveLength(1);
    expect(chat.form).toEqual({
      age: 16,
      city: 'Bogotá',
      fursonaName: 'Kiba',
      species: 'Lobo',
      howDidYouFindUs: 'Por Instagram',
      isMinor: true,
    });
    expect(await chatsOf(BETO)).toBe(0);

    // Un miembro ve el formulario al abrir la solicitud.
    const opened = await request(server)
      .get(`/request-chats/${chat.uuid}`)
      .set('Authorization', tmaAuth(MEMBER))
      .expect(200);
    expect((opened.body as RequestChatDto).form).toMatchObject({
      city: 'Bogotá',
      isMinor: true,
    });
  });

  it('guarda hasta 3 imágenes propias; las ven el solicitante y los miembros, no otro solicitante', async () => {
    const imageIds = [await upload(EVA), await upload(EVA), await upload(EVA)];

    const res = await apply(EVA, { ...FORM, imageIds }).expect(201);

    const chat = res.body as RequestChatDto;
    expect(chat.form?.imageIds).toEqual(imageIds);
    const opened = await request(server)
      .get(`/request-chats/${chat.uuid}`)
      .set('Authorization', tmaAuth(MEMBER))
      .expect(200);
    expect((opened.body as RequestChatDto).form?.imageIds).toEqual(imageIds);
    await download(MEMBER, imageIds[0]).expect(200);
    await download(EVA, imageIds[0]).expect(200);
    await download(DANI, imageIds[0]).expect(403);
  });

  it.each([
    ['con 4 imágenes', () => Promise.all([1, 2, 3, 4].map(() => upload(FER)))],
    [
      'con una imagen repetida',
      async () => {
        const id = await upload(FER);
        return [id, id];
      },
    ],
    ['con un id que no es UUID', () => Promise.resolve(['no-es-uuid'])],
    ['con una imagen que no existe', () => Promise.resolve([UNKNOWN_ID])],
    ['con una imagen de otro usuario', async () => [await upload(DANI)]],
  ])('%s → 400 y no crea nada', async (_, imageIdsOf) => {
    await apply(FER, { ...FORM, imageIds: await imageIdsOf() }).expect(400);

    expect(await chatsOf(FER)).toBe(0);
  });

  it('una segunda solicitud del mismo usuario → 409', async () => {
    await apply(ANA, { ...FORM, age: 30 }).expect(409);

    expect(await chatsOf(ANA)).toBe(1);
  });

  it('dos envíos simultáneos dejan una sola solicitud', async () => {
    const responses = await Promise.all([
      apply(CECI, FORM),
      apply(CECI, FORM),
      apply(CECI, FORM),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await chatsOf(CECI)).toBe(1);
  });

  it.each([
    ['sin edad', { city: 'Cali' }],
    ['con edad 0', { ...FORM, age: 0 }],
    ['con edad no entera', { ...FORM, age: 17.5 }],
    ['con edad como texto', { ...FORM, age: '17' }],
    ['sin ciudad', { age: 20 }],
    ['con ciudad vacía', { ...FORM, city: '' }],
    ['con un campo desconocido', { ...FORM, interests: 'furros' }],
    // Ya no se piden (2026-10-03).
    ['con pronombres', { ...FORM, pronouns: 'él' }],
  ])('%s → 400 y no crea nada', async (_, body) => {
    await apply(DANI, body).expect(400);

    expect(await chatsOf(DANI)).toBe(0);
  });

  it('un miembro no puede crear una solicitud → 403', async () => {
    await apply(MEMBER, FORM).expect(403);

    expect(await chatsOf(MEMBER)).toBe(0);
  });

  it.each(['put', 'patch'] as const)(
    'no hay endpoint para editarla (%s → 404)',
    async (method) => {
      await request(server)
        [method]('/applications')
        .set('Authorization', tmaAuth(ANA))
        .send({ ...FORM, city: 'Cali' })
        .expect(404);
    },
  );
});
