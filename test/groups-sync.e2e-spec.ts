import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Media } from '../src/media/infraestructure/media.schema';
import { Group } from '../src/members/infraestructure/schemas/group.schema';
import { User } from '../src/members/infraestructure/schemas/user.schema';
import { toUUIDString } from '../src/shared/infraestructure/mongo-uuid';
import type { ChatMemberUpdate } from '../src/telegram-bot/telegram-bot.service';
import { createTestApp, TEST_GROUP_ID, TestApp, tmaAuth } from './helpers/app';

const TELEGRAM_DELAY_MS = 2_000;
const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };
const TELEGRAM_GROUP = {
  id: Number(TEST_GROUP_ID),
  type: 'supergroup',
  title: 'FurMeets',
  description: 'Grupo de prueba',
  photo: {
    small_file_id: 'small',
    small_file_unique_id: 'small-u',
    big_file_id: 'big',
    big_file_unique_id: 'big-u',
  },
};

/** Respuesta de Telegram que tarda 2 s. `unref` para no retener a Jest al terminar. */
const slow = <T>(value: T) =>
  new Promise<T>((resolve) =>
    setTimeout(() => resolve(value), TELEGRAM_DELAY_MS).unref(),
  );

describe('POST /groups/sync (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let groups: Model<Group>;
  let users: Model<User>;
  let media: Model<Media>;

  beforeAll(async () => {
    testApp = await createTestApp();
    server = testApp.app.getHttpServer() as App;
    groups = testApp.app.get<Model<Group>>(getModelToken(Group.name));
    users = testApp.app.get<Model<User>>(getModelToken(User.name));
    media = testApp.app.get<Model<Media>>(getModelToken(Media.name));

    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockResolvedValue({ status: 'member' });
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    tg.getProfilePhoto.mockImplementation(() =>
      slow({
        file_id: 'user',
        file_unique_id: 'user-u',
        width: 160,
        height: 160,
      }),
    );
  });

  afterAll(async () => {
    await testApp?.close();
  });

  const memberIds = async () => {
    const group = await groups.findOne().lean();
    return (group?.members ?? []).map((id) =>
      toUUIDString(id as unknown as string),
    );
  };

  /** Simula el update `chat_member` que Telegram envía al bot. */
  const chatMemberUpdate = (userId: number, status: string) => {
    const [[handler]] = testApp.telegramBot.onChatMember.mock.calls as [
      [(update: ChatMemberUpdate) => void],
    ];
    handler({ chatId: Number(TEST_GROUP_ID), userId, status });
  };

  it('primer arranque: crea el grupo desde Telegram y agrega al miembro', async () => {
    await request(server)
      .post('/groups/sync')
      .set('Authorization', tmaAuth({ id: 6001, first_name: 'Ana' }))
      .expect(201);

    const group = await groups.findOne().lean();
    const ana = await users.findOne({ telegramId: 6001 }).lean();
    expect(group).toMatchObject({
      name: 'FurMeets',
      description: 'Grupo de prueba',
    });
    expect(ana?.isMember).toBe(true);
    expect(await memberIds()).toEqual([toUUIDString(ana!._id)]);
    // La foto pequeña del grupo queda en `media`; el grupo guarda su id, no una URL.
    const photo = await media.findOne({ kind: 'group-photo' }).lean();
    expect(photo).toMatchObject({ fileId: 'small', fileUniqueId: 'small-u' });
    expect(toUUIDString(group!.photoMediaId!)).toBe(toUUIDString(photo!._id));
  });

  it('con el grupo guardado no espera a Telegram aunque tarde 2 s', async () => {
    const tg = testApp.telegramBot;
    tg.getGroup.mockImplementation(() => slow(TELEGRAM_GROUP));
    tg.getBotInfo.mockImplementation(() => slow(BOT));

    const startedAt = Date.now();
    await request(server)
      .post('/groups/sync')
      .set('Authorization', tmaAuth({ id: 6002, first_name: 'Beto' }))
      .expect(201);

    expect(Date.now() - startedAt).toBeLessThan(TELEGRAM_DELAY_MS / 2);
    const beto = await users.findOne({ telegramId: 6002 }).lean();
    expect(await memberIds()).toContain(toUUIDString(beto!._id));
  });

  it('si lo expulsan en Telegram, sale del grupo en la siguiente petición', async () => {
    testApp.telegramBot.getMemberFromGroup.mockResolvedValueOnce({
      status: 'kicked',
    });
    chatMemberUpdate(6001, 'kicked');

    await request(server)
      .post('/groups/sync')
      .set('Authorization', tmaAuth({ id: 6001, first_name: 'Ana' }))
      .expect(201);

    const ana = await users.findOne({ telegramId: 6001 }).lean();
    expect(ana?.isMember).toBe(false);
    expect(await memberIds()).not.toContain(toUUIDString(ana!._id));
  });

  it('si Telegram falla, responde igual con la membresía guardada', async () => {
    testApp.telegramBot.getMemberFromGroup.mockRejectedValueOnce(
      new Error('caído'),
    );
    chatMemberUpdate(6002, 'member');

    await request(server)
      .post('/groups/sync')
      .set('Authorization', tmaAuth({ id: 6002, first_name: 'Beto' }))
      .expect(201);

    const beto = await users.findOne({ telegramId: 6002 }).lean();
    expect(beto?.isMember).toBe(true);
    expect(await memberIds()).toContain(toUUIDString(beto!._id));
  });
});
