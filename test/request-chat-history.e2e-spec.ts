import request from 'supertest';
import { App } from 'supertest/types';
import { InitDataAuthService } from '../src/auth/application/init-data-auth.service';
import { CHAT_PROVIDERS } from '../src/chat/chat.providers';
import { RequestChatMessageEntity } from '../src/chat/domain/entities/request-chat-message.entity';
import type { RequestChatMessageRepository } from '../src/chat/domain/services/request-chat-message.repository';
import type { UserEntity } from '../src/members/domain/entities/user.entity';
import { UUID } from '../src/shared/domain/value-objects/uuid.value-object';
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

/** Mensajes sembrados: más de dos páginas de 50. */
const SEEDED = 120;
/** Cada tantos mensajes comparten `createdAt`, como los migrados sin fecha propia (T12). */
const TIED = 3;

/** Grupo de `createdAt` de un mensaje sembrado (`m<i>`). */
const tiedGroup = (content: string) =>
  Math.floor(Number(content.slice(1)) / TIED);

/**
 * En orden: los que empatan en `createdAt` van en cualquier orden entre sí (los desempata
 * `_id`), pero sin mezclarse con los de otra fecha.
 */
const expectChronological = (contents: string[]) => {
  const groups = contents.map(tiedGroup);
  expect(groups).toEqual([...groups].sort((a, b) => a - b));
};

interface MessageDto {
  uuid: string;
  content: string;
}
interface RequestChatDto {
  uuid: string;
  messages: MessageDto[];
  hasOlderMessages: boolean;
}
interface MessagePageDto {
  items: MessageDto[];
  hasMore: boolean;
}

describe('Chat: historial paginado (e2e)', () => {
  let testApp: TestApp;
  let server: App;
  let requestChat: RequestChatDto;
  let otherRequestChat: RequestChatDto;
  /** Un mensaje de la otra solicitud. */
  let foreignMessageId: string;

  const authenticate = (user: TelegramInitDataUser): Promise<UserEntity> =>
    testApp.app
      .get(InitDataAuthService)
      .authenticate(signInitData(user, TEST_BOT_TOKEN));

  const apply = async (user: TelegramInitDataUser) => {
    await authenticate(user);
    return (
      await request(server)
        .post('/applications')
        .set('Authorization', tmaAuth(user))
        .send({ age: 25, city: 'Bogotá' })
        .expect(201)
    ).body as RequestChatDto;
  };

  const open = async (user: TelegramInitDataUser) =>
    (
      await request(server)
        .get(`/request-chats/${requestChat.uuid}`)
        .set('Authorization', tmaAuth(user))
        .expect(200)
    ).body as RequestChatDto;

  const messages = (
    user: TelegramInitDataUser,
    query: Record<string, string | number>,
  ) =>
    request(server)
      .get(`/request-chats/${requestChat.uuid}/messages`)
      .query(query)
      .set('Authorization', tmaAuth(user));

  /** Abre el chat y sube por el historial hasta el principio, como la App. */
  const walkBack = async (limit: number) => {
    const chat = await open(MEMBER);
    let seen = chat.messages;
    let hasMore = chat.hasOlderMessages;
    while (hasMore) {
      const page = (
        await messages(MEMBER, { before: seen[0].uuid, limit }).expect(200)
      ).body as MessagePageDto;
      expect(page.items.length).toBeLessThanOrEqual(limit);
      seen = [...page.items, ...seen];
      hasMore = page.hasMore;
    }
    return seen.map((m) => m.content);
  };

  beforeAll(async () => {
    testApp = await createTestApp();
    const tg = testApp.telegramBot;
    tg.getMemberFromGroup.mockImplementation((id: number) =>
      Promise.resolve({ status: id === MEMBER.id ? 'member' : 'left' }),
    );
    tg.getBotInfo.mockResolvedValue(BOT);
    tg.getGroup.mockResolvedValue(TELEGRAM_GROUP);
    await testApp.app.init();
    server = testApp.app.getHttpServer() as App;
    requestChat = await apply(APPLICANT);
    otherRequestChat = await apply(OTHER_APPLICANT);

    // Directo al repositorio: 120 envíos por socket alargarían la prueba sin aportar.
    const ana = await authenticate(APPLICANT);
    const repository = testApp.app.get<RequestChatMessageRepository>(
      CHAT_PROVIDERS.RequestChatMessageRepository,
    );
    const start = Date.now() + 60_000;
    for (let i = 0; i < SEEDED; i++) {
      await repository.insert(
        RequestChatMessageEntity.send(
          UUID.from(requestChat.uuid),
          ana,
          { content: `m${i}` },
          new Date(start + Math.floor(i / TIED) * 1000),
        ),
      );
    }
    const foreign = RequestChatMessageEntity.send(
      UUID.from(otherRequestChat.uuid),
      await authenticate(OTHER_APPLICANT),
      { content: 'de Beto' },
      new Date(),
    );
    await repository.insert(foreign);
    foreignMessageId = foreign.id.value;
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('enviar la solicitud la trae sin mensajes ni anteriores', () => {
    expect(requestChat.messages).toEqual([]);
    expect(requestChat.hasOlderMessages).toBe(false);
  });

  it('abrir un chat con muchos mensajes trae solo los últimos 50, en orden', async () => {
    const chat = await open(APPLICANT);

    const contents = chat.messages.map((m) => m.content);
    expect(chat.hasOlderMessages).toBe(true);
    expect(contents).toHaveLength(50);
    expectChronological(contents);
    // Los 50 más recientes: el grupo empatado del borde aporta los que falten.
    const oldest = Math.floor((SEEDED - 50) / TIED);
    expect(Math.min(...contents.map(tiedGroup))).toBe(oldest);
    expect(contents).toEqual(
      expect.arrayContaining(
        Array.from(
          { length: SEEDED - (oldest + 1) * TIED },
          (_, i) => `m${(oldest + 1) * TIED + i}`,
        ),
      ),
    );
  });

  it.each([50, 7])(
    'subir por el historial de a %i no repite ni salta mensajes, aunque empaten en createdAt',
    async (limit) => {
      const contents = await walkBack(limit);

      expect(contents).toHaveLength(SEEDED);
      expect(new Set(contents).size).toBe(SEEDED);
      expect(contents).toEqual(
        expect.arrayContaining(
          Array.from({ length: SEEDED }, (_, i) => `m${i}`),
        ),
      );
      expectChronological(contents);
    },
  );

  it('la última página de anteriores trae hasMore en false', async () => {
    const chat = await open(MEMBER);
    const page = (
      await messages(MEMBER, {
        before: chat.messages[0].uuid,
        limit: 100,
      }).expect(200)
    ).body as MessagePageDto;

    expect(page.items).toHaveLength(SEEDED - 50);
    expect(page.hasMore).toBe(false);
  });

  it('un before de otra solicitud → 400', async () => {
    await messages(MEMBER, {
      before: foreignMessageId,
    }).expect(400);
  });

  it.each([
    [
      'before y after a la vez',
      { before: UUID.generate().value, after: UUID.generate().value },
    ],
    ['sin before ni after', {}],
    ['un before que no es UUID', { before: 'no-es-uuid' }],
  ])('%s → 400', async (_, query) => {
    await messages(MEMBER, query).expect(400);
  });

  it('otro solicitante no lee el historial → 403', async () => {
    const chat = await open(MEMBER);
    await messages(OTHER_APPLICANT, {
      before: chat.messages[0].uuid,
    }).expect(403);
  });
});
