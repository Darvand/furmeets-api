/**
 * Cuenta cuántos documentos hidrata Mongoose en `GET /request-chats`, con las mismas
 * consultas que la API: `ChatMongoRepository.getAllRequestChats` (`find()` + 2 `populate`,
 * sin `lean()`) y `RequestChatMessageMongoRepository.findByRequestChats` (con `lean()`, no
 * hidrata). Usa datos sembrados con `scripts/seed/seed-data.ts` en un Mongo en memoria.
 *
 * Uso: npm run perf:hydration
 *   Mismas variables de volumen que seed:staging (SEED_MEMBERS, SEED_IN_PROGRESS, ...).
 *   SEED_SCALES=1,2,4 repite la medición multiplicando el número de solicitudes.
 *
 * No toca ninguna base real.
 */
import mongoose, { Document, Model } from 'mongoose';
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
import { DEFAULT_SEED_OPTIONS, seed, SeedOptions } from '../seed/seed-data';

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  return raw ? Number(raw) : fallback;
}

/** Recorre el resultado y cuenta instancias de documento (y subdocumento) de Mongoose. */
function countDocuments(roots: unknown[]) {
  const unique = new Set<object>();
  let references = 0;
  const visit = (value: unknown, seen: Set<object>) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Document) {
      references++;
      unique.add(value);
      const fields = value.toObject({
        depopulate: false,
        virtuals: false,
      }) as object;
      for (const key of Object.keys(fields)) {
        visit(
          (value as unknown as Record<string, unknown>)[key],
          new Set(seen),
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, seen);
    }
  };
  for (const root of roots) visit(root, new Set());
  return { unique: unique.size, references };
}

async function measure(
  chatModel: Model<RequestChat>,
  messageModel: Model<RequestChatMessage>,
): Promise<{
  ms: number;
  chats: number;
  docs: { unique: number; references: number };
}> {
  const startedAt = performance.now();
  const chats = await chatModel
    .find()
    .populate('requester')
    .populate('votes.from')
    .exec();
  const messages = await messageModel
    .find({ requestChatId: { $in: chats.map((chat) => chat._id) } })
    .sort({ createdAt: 1 })
    .populate('authorId')
    .lean()
    .exec();
  const ms = performance.now() - startedAt;
  return { ms, chats: chats.length, docs: countDocuments([chats, messages]) };
}

async function main() {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri('hydration'));
  mongoose.model(User.name, UserSchema);
  const chatModel = mongoose.model<RequestChat>(
    RequestChat.name,
    RequestChatSchema,
  );
  const messageModel = mongoose.model<RequestChatMessage>(
    RequestChatMessage.name,
    RequestChatMessageSchema,
  );
  const db = mongoose.connection.db!;

  const base: Partial<SeedOptions> = {
    members: numberEnv('SEED_MEMBERS', DEFAULT_SEED_OPTIONS.members),
    inProgress: numberEnv('SEED_IN_PROGRESS', DEFAULT_SEED_OPTIONS.inProgress),
    approved: numberEnv('SEED_APPROVED', DEFAULT_SEED_OPTIONS.approved),
    rejected: numberEnv('SEED_REJECTED', DEFAULT_SEED_OPTIONS.rejected),
    minMessages: numberEnv(
      'SEED_MIN_MESSAGES',
      DEFAULT_SEED_OPTIONS.minMessages,
    ),
    maxMessages: numberEnv(
      'SEED_MAX_MESSAGES',
      DEFAULT_SEED_OPTIONS.maxMessages,
    ),
  };
  const scales = (process.env.SEED_SCALES ?? '1').split(',').map(Number);

  try {
    for (const scale of scales) {
      await db.dropDatabase();
      const result = await seed(db, {
        ...base,
        inProgress: base.inProgress! * scale,
        approved: base.approved! * scale,
        rejected: base.rejected! * scale,
      });
      const [{ reads = 0 } = {}] = await db
        .collection('requestchatmessages')
        .aggregate<{ reads: number }>([
          { $group: { _id: null, reads: { $sum: { $size: '$readBy' } } } },
        ])
        .toArray();
      // Primera medición calienta la conexión; se reporta la segunda.
      await measure(chatModel, messageModel);
      const { ms, docs } = await measure(chatModel, messageModel);
      console.log(
        `x${scale}: ${result.requestChats} solicitudes · ${result.messages} mensajes · ` +
          `${reads} leídos · ${result.votes} votos → ${docs.references} documentos hidratados ` +
          `(${docs.unique} instancias distintas) · ${ms.toFixed(0)} ms en esta máquina`,
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
