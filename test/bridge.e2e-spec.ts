import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
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

const MEMBER = { id: 9701, first_name: 'Mia' };
const APPLICANT = { id: 9702, first_name: 'Ana_*fur*' };
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = { id: Number(TEST_GROUP_ID), type: 'supergroup' };
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('foto del puente'),
]);

interface StoredMessage {
  _id: mongo.UUID;
  groupMessageIds?: number[];
}

interface MessageDto {
  uuid: string;
  content: string;
  imageIds?: string[];
}

/** Puente al grupo (T27): cada mensaje del solicitante se republica sin afectar al chat. */
describe('Puente: republicación en el grupo (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let url: string;
  let db: Connection;
  let requestChatId: string;
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

  const send = (socket: Socket, payload: object) =>
    socket.emitWithAck('request-chat', {
      requestChatUUID: requestChatId,
      ...payload,
    }) as Promise<MessageDto>;

  const upload = async (user: TelegramInitDataUser): Promise<string> => {
    const res = await request(server)
      .post('/media')
      .set('Authorization', tmaAuth(user))
      .attach('file', JPEG, { filename: 'foto.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return (res.body as { id: string }).id;
  };

  const drain = () => testApp.app.get(BackgroundQueue).drain();

  /** Lo guardado de un mensaje, con los ids que tiene en el grupo. */
  const stored = (id: string) =>
    db
      .collection<StoredMessage>('requestchatmessages')
      .findOne({ _id: new mongo.UUID(id) });

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
        file_id: `puente-${uploads}`,
        file_unique_id: `puente-${uploads}-u`,
        width: 800,
        height: 800,
      });
    });
    await testApp.app.listen(0);
    server = testApp.app.getHttpServer() as App;
    const { port } = (server as unknown as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    db = testApp.app.get<Connection>(getConnectionToken());
    const auth = testApp.app.get(InitDataAuthService);
    await auth.authenticate(signInitData(MEMBER, TEST_BOT_TOKEN));
    await auth.authenticate(signInitData(APPLICANT, TEST_BOT_TOKEN));
    requestChatId = (
      (
        await request(server)
          .post('/applications')
          .set('Authorization', tmaAuth(APPLICANT))
          .send({ age: 25, city: 'Bogotá' })
          .expect(201)
      ).body as { uuid: string }
    ).uuid;
  });

  beforeEach(() => {
    testApp.telegramBot.sendTextToGroup.mockClear();
    testApp.telegramBot.sendPhotosToGroup.mockClear();
  });

  afterEach(async () => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    await drain();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('republica el texto del solicitante con su encabezado y guarda el id del grupo', async () => {
    const ana = await connect(APPLICANT);

    const ack = await send(ana, { content: 'hola, soy _nueva_' });
    await drain();

    const tg = testApp.telegramBot;
    expect(tg.sendTextToGroup).toHaveBeenCalledTimes(1);
    expect(tg.sendTextToGroup).toHaveBeenCalledWith(
      'Ana_*fur* · solicitud\nhola, soy _nueva_',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text_link',
          url: expect.stringContaining(`startapp=${requestChatId}`) as string,
        }),
      ]),
    );
    const groupMessageId = (await tg.sendTextToGroup.mock.results[0]
      .value) as number;
    expect((await stored(ack.uuid))?.groupMessageIds).toEqual([groupMessageId]);
  });

  it('republica las imágenes reutilizando su file_id, sin volver a subirlas', async () => {
    const ana = await connect(APPLICANT);
    const imageIds = [await upload(APPLICANT), await upload(APPLICANT)];
    const uploadsBefore =
      testApp.telegramBot.uploadPhotoToStorage.mock.calls.length;

    const ack = await send(ana, { content: 'mi fursona', imageIds });
    await drain();

    const tg = testApp.telegramBot;
    expect(tg.sendPhotosToGroup).toHaveBeenCalledTimes(1);
    const [fileIds, caption] = tg.sendPhotosToGroup.mock.calls[0] as [
      string[],
      string,
    ];
    expect(fileIds).toHaveLength(2);
    expect(fileIds.every((id) => id.startsWith('puente-'))).toBe(true);
    expect(caption).toBe('Ana_*fur* · solicitud\nmi fursona');
    expect(tg.uploadPhotoToStorage.mock.calls).toHaveLength(uploadsBefore);
    expect((await stored(ack.uuid))?.groupMessageIds).toHaveLength(2);
  });

  it('lo que escribe un miembro no se republica', async () => {
    const mia = await connect(MEMBER);

    await send(mia, { content: 'bienvenida' });
    await drain();

    expect(testApp.telegramBot.sendTextToGroup).not.toHaveBeenCalled();
    expect(testApp.telegramBot.sendPhotosToGroup).not.toHaveBeenCalled();
  });

  it('un reenvío con el mismo clientMessageId no se republica otra vez', async () => {
    const ana = await connect(APPLICANT);
    const clientMessageId = randomUUID();

    await send(ana, { content: 'una sola vez', clientMessageId });
    await send(ana, { content: 'una sola vez', clientMessageId });
    await drain();

    expect(testApp.telegramBot.sendTextToGroup).toHaveBeenCalledTimes(1);
  });

  it('si Telegram falla, el mensaje igual queda guardado y emitido, y el error se registra', async () => {
    const tg = testApp.telegramBot;
    const previous = tg.sendTextToGroup.getMockImplementation()!;
    tg.sendTextToGroup.mockRejectedValue(new Error('Telegram caído'));
    const errors = jest.spyOn(Logger.prototype, 'error');
    const [ana, mia] = await Promise.all([connect(APPLICANT), connect(MEMBER)]);
    const received = new Promise<MessageDto>((resolve) =>
      mia.once('request-chat', resolve),
    );

    const ack = await send(ana, { content: 'no llega al grupo' });
    await drain();

    expect((await received).content).toBe('no llega al grupo');
    expect(tg.sendTextToGroup).toHaveBeenCalledTimes(3);
    expect(errors).toHaveBeenCalledWith(
      expect.stringContaining('Telegram caído'),
    );
    const message = await stored(ack.uuid);
    expect(message).not.toBeNull();
    expect(message?.groupMessageIds).toBeUndefined();
    const history = (
      await request(server)
        .get(`/request-chats/${requestChatId}`)
        .set('Authorization', tmaAuth(MEMBER))
        .expect(200)
    ).body as { messages: MessageDto[] };
    expect(history.messages.at(-1)?.content).toBe('no llega al grupo');
    tg.sendTextToGroup.mockReset().mockImplementation(previous);
    errors.mockRestore();
  });
});
