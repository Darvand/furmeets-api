/**
 * Mide `GET /request-chats` según cuántos mensajes tiene cada solicitud (T40). Compara:
 * - antes: las consultas de T10 (`find()` + 2 `populate` de todas las solicitudes y
 *   después todos sus mensajes con su autor), que crecen con el total de mensajes;
 * - ahora: `ChatMongoRepository.listSummaries`, la agregación que usa la API.
 *
 * Usa datos sembrados con `scripts/seed/seed-data.ts` en un Mongo en memoria, con los
 * índices de los schemas. No toca ninguna base real.
 *
 * Uso: npm run perf:list
 *   PERF_REQUEST_CHATS=50       solicitudes sembradas
 *   PERF_MESSAGES=10,50,200,400 mensajes por solicitud, una medición por valor
 *   PERF_RUNS=30                repeticiones por medición (se reporta p50 y p95)
 *   PERF_LIMIT=50               tamaño de página del listado nuevo
 */
import mongoose, { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  User,
  UserSchema,
} from '../../src/members/infraestructure/schemas/user.schema';
import {
  RequestChat,
  RequestChatSchema,
} from '../../src/chat/infraestructure/schemas/request-chat.schema';
import {
  RequestChatMessage,
  RequestChatMessageSchema,
} from '../../src/chat/infraestructure/schemas/request-chat-message.schema';
import { ChatMongoRepository } from '../../src/chat/infraestructure/repositories/chat-mongo.repository';
import { UUID } from '../../src/shared/domain/value-objects/uuid.value-object';
import { toUUIDString } from '../../src/shared/infraestructure/mongo-uuid';
import { seed } from '../seed/seed-data';

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  return raw ? Number(raw) : fallback;
}

async function timings(
  runs: number,
  fn: () => Promise<unknown>,
): Promise<{ p50: number; p95: number }> {
  await fn(); // calienta la conexión y la caché del plan
  const ms: number[] = [];
  for (let i = 0; i < runs; i++) {
    const startedAt = performance.now();
    await fn();
    ms.push(performance.now() - startedAt);
  }
  ms.sort((a, b) => a - b);
  const at = (q: number) =>
    ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
  return { p50: at(0.5), p95: at(0.95) };
}

/** Las consultas de `GET /request-chats` en T10, antes de este cambio. */
async function before(
  chatModel: Model<RequestChat>,
  messageModel: Model<RequestChatMessage>,
): Promise<void> {
  const chats = await chatModel
    .find()
    .populate('requester')
    .populate('votes.from')
    .exec();
  await messageModel
    .find({ requestChatId: { $in: chats.map((chat) => chat._id) } })
    .sort({ createdAt: 1 })
    .populate('authorId')
    .lean()
    .exec();
}

async function main() {
  const requestChats = numberEnv('PERF_REQUEST_CHATS', 50);
  const runs = numberEnv('PERF_RUNS', 30);
  const limit = numberEnv('PERF_LIMIT', 50);
  const perChat = (process.env.PERF_MESSAGES ?? '10,50,200,400')
    .split(',')
    .map(Number);

  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('request-list'));
  const userModel = mongoose.model(User.name, UserSchema);
  const chatModel = mongoose.model<RequestChat>(
    RequestChat.name,
    RequestChatSchema,
  );
  const messageModel = mongoose.model<RequestChatMessage>(
    RequestChatMessage.name,
    RequestChatMessageSchema,
  );
  const repository = new ChatMongoRepository(chatModel);
  const db = mongoose.connection.db!;

  try {
    for (const messages of perChat) {
      await db.dropDatabase();
      const result = await seed(db, {
        inProgress: Math.ceil(requestChats / 2),
        approved: Math.floor(requestChats / 4),
        rejected:
          requestChats -
          Math.ceil(requestChats / 2) -
          Math.floor(requestChats / 4),
        minMessages: messages,
        maxMessages: messages,
      });
      await Promise.all(
        [userModel, chatModel, messageModel].map((model) =>
          model.syncIndexes(),
        ),
      );
      const member = await userModel
        .findOne({ isMember: true }, { _id: 1 })
        .lean()
        .exec();
      const viewer = UUID.from(toUUIDString(member!._id));

      const old = await timings(runs, () => before(chatModel, messageModel));
      const now = await timings(runs, () =>
        repository.listSummaries(viewer, { limit }),
      );
      console.log(
        `${result.requestChats} solicitudes × ${messages} mensajes (${result.messages} en total) → ` +
          `antes p50 ${old.p50.toFixed(1)} ms / p95 ${old.p95.toFixed(1)} ms · ` +
          `ahora p50 ${now.p50.toFixed(1)} ms / p95 ${now.p95.toFixed(1)} ms`,
      );
    }
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
