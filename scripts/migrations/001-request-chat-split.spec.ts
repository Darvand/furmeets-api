import { MongoMemoryServer } from 'mongodb-memory-server';
import { mongo } from 'mongoose';
import {
  BACKUP_COLLECTION,
  legacyOf,
  migrate,
  type SourceRequestChat,
  toMessageDocs,
} from './001-request-chat-split';

jest.setTimeout(60_000);

const uuid = () => new mongo.UUID();
const at = (iso: string) => new Date(iso);

describe('Migración 001: transformaciones', () => {
  const chatId = uuid();
  const author = uuid();

  it('un mensaje embebido conserva _id, autor, contenido y createdAt; descarta el resto', () => {
    const messageId = uuid();
    const { docs, skipped } = toMessageDocs({
      _id: chatId,
      messages: [
        {
          _id: messageId,
          user: author,
          content: 'hola',
          createdAt: at('2026-01-01T10:00:00Z'),
          viewedBy: [{ by: author }],
          updatedAt: at('2026-02-01T10:00:00Z'),
        } as never,
      ],
    });

    expect(skipped).toEqual([]);
    expect(docs).toEqual([
      {
        _id: messageId,
        requestChatId: chatId,
        authorId: author,
        content: 'hola',
        createdAt: at('2026-01-01T10:00:00Z'),
      },
    ]);
  });

  it('sin createdAt toma el de la solicitud; sin _id o sin autor no se migra y se informa', () => {
    const chat: SourceRequestChat = {
      _id: chatId,
      createdAt: at('2025-12-01T00:00:00Z'),
      messages: [
        { _id: uuid(), user: author, content: 'sin fecha' },
        { user: author, content: 'sin id' },
        { _id: uuid(), content: 'sin autor' },
      ],
    };

    const { docs, skipped } = toMessageDocs(chat);

    expect(docs).toHaveLength(1);
    expect(docs[0].createdAt).toEqual(at('2025-12-01T00:00:00Z'));
    expect(skipped.map((s) => [s.index, s.reason])).toEqual([
      [1, 'sin _id'],
      [2, 'sin autor'],
    ]);
  });

  it('las respuestas del formulario anterior pasan a legacy, recortadas y sin vacías', () => {
    expect(
      legacyOf({
        _id: chatId,
        whereYouFoundUs: ' Instagram ',
        interests: '  ',
      }),
    ).toEqual({ howDidYouFindUs: 'Instagram' });
    expect(legacyOf({ _id: chatId })).toEqual({});
  });
});

describe('Migración 001 contra Mongo', () => {
  let server: MongoMemoryServer;
  let client: mongo.MongoClient;
  let db: mongo.Db;
  /** Colecciones con `_id` UUID (el driver supone `ObjectId`). */
  const col = (name: string) =>
    db.collection<mongo.Document & { _id: mongo.UUID }>(name);
  const ana = uuid();
  const beto = uuid();
  const member = uuid();
  const oldChat = uuid();
  const emptyChat = uuid();
  const newChat = uuid();

  /** Datos con el formato de `main`: mensajes y leídos embebidos. */
  const seedOldFormat = async () => {
    await col('requestchats').insertMany([
      {
        _id: oldChat,
        requester: ana,
        whereYouFoundUs: 'Por un amigo',
        interests: 'Juegos de mesa',
        state: 'InProgress',
        createdAt: at('2025-11-01T00:00:00Z'),
        votes: [
          { _id: new mongo.ObjectId(), from: member, type: 'approve' },
          { _id: new mongo.ObjectId(), from: beto, type: 'reject' },
        ],
        messages: Array.from({ length: 3 }, (_, i) => ({
          _id: uuid(),
          user: i % 2 ? member : ana,
          content: `mensaje ${i}`,
          viewedBy: [{ by: member, createdAt: at('2025-11-02T00:00:00Z') }],
          createdAt: at(`2025-11-01T0${i}:00:00Z`),
          updatedAt: at('2025-11-03T00:00:00Z'),
        })),
      },
      {
        _id: emptyChat,
        requester: beto,
        state: 'Rejected',
        createdAt: at('2025-10-01T00:00:00Z'),
        votes: [],
        messages: [],
      },
      // Ya con el modelo actual (T13): no se toca.
      {
        _id: newChat,
        requester: member,
        form: { age: 20, city: 'Cali' },
        state: 'InProgress',
        createdAt: at('2026-10-03T00:00:00Z'),
        votes: [],
      },
    ]);
    await col('users').insertMany([
      {
        _id: ana,
        name: 'Ana',
        avatarUrl: 'photos/file_1.jpg',
        species: 'Lobo ártico',
      },
      { _id: beto, name: 'Beto' },
    ]);
  };

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new mongo.MongoClient(server.getUri('migracion'));
    await client.connect();
    db = client.db();
  });

  afterAll(async () => {
    await client?.close();
    await server?.stop();
  });

  beforeEach(async () => {
    await db.dropDatabase();
    await seedOldFormat();
  });

  it('sin --apply solo informa: no escribe nada', async () => {
    const snapshot = () => col('requestchats').find().toArray();
    const before = JSON.stringify(await snapshot());

    const report = await migrate(db, { apply: false });

    expect(report.before).toMatchObject({
      requestChats: 3,
      chatsWithEmbeddedMessages: 2,
      embeddedMessages: 3,
      chatsToMarkLegacy: 2,
      votes: 2,
      usersWithAvatarUrl: 1,
    });
    expect(JSON.stringify(await snapshot())).toBe(before);
    expect(await col('requestchatmessages').countDocuments()).toBe(0);
    expect(
      await db.listCollections({ name: BACKUP_COLLECTION }).toArray(),
    ).toHaveLength(0);
  });

  it('migra mensajes, marca legacy, quita avatarUrl y cuadra los conteos', async () => {
    const report = await migrate(db, { apply: true });

    expect(report.backup).toBe('creada');
    expect(report.messagesInserted).toBe(3);
    expect(report.legacyMarked).toBe(2);
    expect(report.avatarUrlsRemoved).toBe(1);
    expect(report.check).toEqual({
      backupMessages: 3,
      backupMessagesFound: 3,
      backupVotes: 2,
      currentVotes: 2,
      ok: true,
    });
    expect(report.after).toMatchObject({
      requestChats: 3,
      chatsWithEmbeddedMessages: 0,
      embeddedMessages: 0,
      chatsToMarkLegacy: 0,
      votes: 2,
      usersWithAvatarUrl: 0,
    });

    const chats = col('requestchats');
    const old = await chats.findOne({ _id: oldChat });
    expect(old).not.toHaveProperty('messages');
    expect(old).not.toHaveProperty('whereYouFoundUs');
    expect(old).not.toHaveProperty('interests');
    expect(old?.legacy).toEqual({
      howDidYouFindUs: 'Por un amigo',
      interests: 'Juegos de mesa',
    });
    expect((await chats.findOne({ _id: emptyChat }))?.legacy).toEqual({});
    const untouched = await chats.findOne({ _id: newChat });
    expect(untouched).not.toHaveProperty('legacy');
    expect(untouched?.form).toEqual({ age: 20, city: 'Cali' });

    const messages = await col('requestchatmessages')
      .find({ requestChatId: oldChat })
      .sort({ createdAt: 1 })
      .toArray();
    expect(messages.map((m) => m.content as string)).toEqual([
      'mensaje 0',
      'mensaje 1',
      'mensaje 2',
    ]);
    expect(Object.keys(messages[0]).sort()).toEqual(
      ['_id', 'authorId', 'content', 'createdAt', 'requestChatId'].sort(),
    );

    const user = await col('users').findOne({ _id: ana });
    expect(user).not.toHaveProperty('avatarUrl');
    expect(user?.species).toBe('Lobo ártico');

    // La copia conserva la colección original tal cual.
    const backup = await col(BACKUP_COLLECTION).findOne({ _id: oldChat });
    expect(backup?.messages).toHaveLength(3);
    expect(backup?.whereYouFoundUs).toBe('Por un amigo');
  });

  it('correrla dos veces no duplica nada ni toca la copia', async () => {
    await migrate(db, { apply: true });
    const backupBefore = JSON.stringify(
      await col(BACKUP_COLLECTION).find().toArray(),
    );

    const second = await migrate(db, { apply: true });

    expect(second.backup).toBe('ya existía');
    expect(second.messagesInserted).toBe(0);
    expect(second.legacyMarked).toBe(0);
    expect(second.check?.ok).toBe(true);
    expect(await col('requestchatmessages').countDocuments()).toBe(3);
    expect(JSON.stringify(await col(BACKUP_COLLECTION).find().toArray())).toBe(
      backupBefore,
    );
  });

  it('si se cortó a mitad (mensajes copiados pero sin quitar), al repetir termina sin duplicar', async () => {
    const original = await col('requestchats').findOne({ _id: oldChat });
    await migrate(db, { apply: true });
    // Simula un corte: la solicitud vuelve a tener sus mensajes embebidos.
    await col('requestchats').updateOne(
      { _id: oldChat },
      { $set: { messages: original?.messages } },
    );

    const report = await migrate(db, { apply: true });

    expect(report.messagesInserted).toBe(0);
    expect(report.messagesAlreadyThere).toBe(3);
    expect(await col('requestchatmessages').countDocuments()).toBe(3);
    expect(report.check?.ok).toBe(true);
  });

  it('un mensaje sin autor no se migra: queda en la copia y la verificación no cuadra', async () => {
    await col('requestchats').updateOne(
      { _id: emptyChat },
      { $set: { messages: [{ _id: uuid(), content: 'huérfano' }] } },
    );

    const report = await migrate(db, { apply: true });

    expect(report.skipped).toHaveLength(1);
    expect(report.check?.ok).toBe(false);
    expect(
      (await col(BACKUP_COLLECTION).findOne({ _id: emptyChat }))?.messages,
    ).toHaveLength(1);
  });
});
