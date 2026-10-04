import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { BackgroundQueue } from '../src/shared/async/background-queue';
import {
  createTestApp,
  TEST_BOT_TOKEN,
  TEST_GROUP_ID,
  TestApp,
  tmaAuth,
} from './helpers/app';
import { signInitData, TelegramInitDataUser } from './helpers/init-data';

const MEMBER = { id: 9301, first_name: 'Mia' };
const APPLICANT = { id: 9302, first_name: 'Ana' };
const OTHER_APPLICANT = { id: 9303, first_name: 'Beto' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('foto del chat'),
]);

interface MessageDto {
  uuid: string;
  content: string;
  imageIds?: string[];
}
interface RequestChatDto {
  uuid: string;
  messages: MessageDto[];
}
interface WsError {
  message: string;
}

describe('Chat: imágenes (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let db: Connection;
  let requestChat: RequestChatDto;
  const sockets: Socket[] = [];

  const connect = async (user: TelegramInitDataUser): Promise<Socket> => {
    const socket = io(url, {
      auth: { initData: signInitData(user, TEST_BOT_TOKEN) },
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  };

  /** Envía y devuelve el ack, o la excepción si la API rechaza el mensaje. */
  const send = (socket: Socket, payload: object) =>
    new Promise<MessageDto | WsError>((resolve) => {
      socket.once('exception', resolve);
      socket.emit('request-chat', payload, (ack: MessageDto) => {
        socket.off('exception', resolve);
        resolve(ack);
      });
    });

  const upload = async (user: TelegramInitDataUser): Promise<string> => {
    const res = await request(server)
      .post('/media')
      .set('Authorization', tmaAuth(user))
      .attach('file', JPEG, { filename: 'foto.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  const download = (user: TelegramInitDataUser, id: string) =>
    request(server).get(`/media/${id}`).set('Authorization', tmaAuth(user));

  const apply = async (user: TelegramInitDataUser) => {
    await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));
    return (
      await request(server)
        .post('/applications')
        .set('Authorization', tmaAuth(user))
        .send({ age: 25, city: 'Bogotá' })
        .expect(201)
    ).body as RequestChatDto;
  };

  const storedMessages = () =>
    db.collection('requestchatmessages').countDocuments();

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
        file_id: `chat-${uploads}`,
        file_unique_id: `chat-${uploads}-u`,
        width: 800,
        height: 800,
      });
    });
    tg.getFilePath.mockImplementation((fileId: string) =>
      Promise.resolve(`photos/${fileId}.jpg`),
    );
    tg.downloadFile.mockImplementation(() =>
      Promise.resolve(new Response('bytes de la foto')),
    );
    await testApp.app.listen(0);
    server = testApp.app.getHttpServer() as App;
    const { port } = (server as unknown as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    db = testApp.app.get<Connection>(getConnectionToken());
    await testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(MEMBER, TEST_BOT_TOKEN));
    requestChat = await apply(APPLICANT);
    // Registra a otro solicitante, que no debe ver las imágenes de este chat.
    await apply(OTHER_APPLICANT);
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await testApp.app.get(BackgroundQueue).drain();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  describe('imágenes', () => {
    it('el solicitante manda texto con sus imágenes; el miembro recibe el mensaje y las ve', async () => {
      const [ana, mia] = await Promise.all([
        connect(APPLICANT),
        connect(MEMBER),
      ]);
      const imageIds = [await upload(APPLICANT), await upload(APPLICANT)];
      const received = new Promise<MessageDto>((resolve) =>
        mia.once('request-chat', resolve),
      );

      const ack = (await send(ana, {
        requestChatUUID: requestChat.uuid,
        content: 'mi fursona',
        imageIds,
      })) as MessageDto;

      expect(ack.imageIds).toEqual(imageIds);
      expect((await received).imageIds).toEqual(imageIds);
      await download(MEMBER, imageIds[0]).expect(200);
    });

    it('un miembro manda solo una imagen: el solicitante la ve y otro solicitante no', async () => {
      const [ana, mia] = await Promise.all([
        connect(APPLICANT),
        connect(MEMBER),
      ]);
      const [imageId] = [await upload(MEMBER)];
      await download(APPLICANT, imageId).expect(403);
      const received = new Promise<MessageDto>((resolve) =>
        ana.once('request-chat', resolve),
      );

      const ack = (await send(mia, {
        requestChatUUID: requestChat.uuid,
        imageIds: [imageId],
      })) as MessageDto;

      expect(ack.content).toBe('');
      expect((await received).imageIds).toEqual([imageId]);
      await download(APPLICANT, imageId).expect(200);
      await download(OTHER_APPLICANT, imageId).expect(403);
    });

    it.each([
      [
        'con una imagen de otro usuario',
        () => upload(MEMBER).then((id) => [id]),
      ],
      ['con una imagen que no existe', () => Promise.resolve([randomUUID()])],
      [
        'con más de 10 imágenes',
        () => Promise.resolve(Array.from({ length: 11 }, () => randomUUID())),
      ],
    ])('%s → invalid-payload y no se guarda', async (_, imageIdsOf) => {
      const ana = await connect(APPLICANT);
      const imageIds = await imageIdsOf();
      const before = await storedMessages();

      const result = await send(ana, {
        requestChatUUID: requestChat.uuid,
        content: 'mira',
        imageIds,
      });

      expect((result as WsError).message).toBe('invalid-payload');
      expect(await storedMessages()).toBe(before);
    });

    it('sin texto ni imágenes → invalid-payload', async () => {
      const ana = await connect(APPLICANT);

      const result = await send(ana, { requestChatUUID: requestChat.uuid });

      expect((result as WsError).message).toBe('invalid-payload');
    });
  });
});
