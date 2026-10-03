/**
 * Migración 001 (T12 · SPEC §9.1): de las solicitudes con mensajes embebidos (código de
 * `main`) al modelo actual.
 *
 * Uso (desde la raíz del repo):
 *
 *   DB_URI="mongodb+srv://.../<base>" npm run migrate:001                       # solo informa
 *   DB_URI=... CONFIRM=<base> npm run migrate:001 -- --apply                     # migra
 *
 * Qué hace con `--apply`, en orden (correrlo de nuevo no duplica nada):
 *   1. Copia `requestchats` en `requestchats_pre_001`, solo la primera vez. Es la colección
 *      original conservada (SPEC §9.1). Se copia en lugar de renombrar para que la colección
 *      viva conserve sus índices (entre ellos el único de `requester`, T13).
 *   2. Pasa cada mensaje embebido a `requestchatmessages` con su mismo `_id`, autor,
 *      contenido y `createdAt` (se descartan `viewedBy` y `updatedAt`). Inserta sin pisar
 *      los que ya estén y después quita `messages` de la solicitud.
 *   3. Marca como `legacy` toda solicitud sin `form`: `whereYouFoundUs` pasa a
 *      `legacy.howDidYouFindUs` ("¿Cómo conociste FurMeets?") e `interests` a
 *      `legacy.interests`. Cubre también las creadas con el formulario anterior antes de T15.
 *   4. Quita `users.avatarUrl` (un `file_path` que caduca; el avatar se resincroniza).
 *
 * Al final compara conteos: mensajes de la copia que están en la colección nueva y votos
 * de la copia contra los actuales. Si algo no cuadra, termina con código 1.
 *
 * Correr con la API detenida o sin tráfico: un voto que llegue durante la migración
 * descuadra el conteo de votos (no se pierde). En producción, solo con respaldo previo y
 * aprobación (SPEC §12). `species` no necesita migrar datos: ya es texto; el código dejó
 * de exigir el enum.
 */
import { mongo } from 'mongoose';

export const BACKUP_COLLECTION = 'requestchats_pre_001';
const REQUEST_CHATS = 'requestchats';
const MESSAGES = 'requestchatmessages';
const USERS = 'users';
const BATCH = 500;

type Id = mongo.Binary;

/** Mensaje embebido tal como lo guardaba el código de `main`. */
export interface EmbeddedMessage {
  _id?: Id;
  user?: Id;
  content?: unknown;
  createdAt?: Date;
}

/** Solicitud en la base, antes o después de migrar. */
export interface SourceRequestChat {
  _id: Id;
  createdAt?: Date;
  messages?: EmbeddedMessage[];
  whereYouFoundUs?: unknown;
  interests?: unknown;
  form?: unknown;
  legacy?: unknown;
  votes?: unknown[];
}

/** Documento de `requestchatmessages` (ver `RequestChatMessage`). */
export interface MessageDoc {
  _id: Id;
  requestChatId: Id;
  authorId: Id;
  content: string;
  createdAt: Date;
}

export interface SkippedMessage {
  requestChatId: string;
  index: number;
  reason: string;
}

export interface LegacyDoc {
  howDidYouFindUs?: string;
  interests?: string;
}

const idText = (id: Id) =>
  id.sub_type === mongo.Binary.SUBTYPE_UUID
    ? id.toUUID().toHexString(true)
    : id.toString('hex');

/**
 * Los mensajes embebidos de una solicitud, como documentos de la colección nueva. Un
 * mensaje sin `_id` o sin autor no se puede migrar: se informa y queda en la copia.
 * Sin `createdAt` toma el de la solicitud.
 */
export function toMessageDocs(chat: SourceRequestChat): {
  docs: MessageDoc[];
  skipped: SkippedMessage[];
} {
  const docs: MessageDoc[] = [];
  const skipped: SkippedMessage[] = [];
  (chat.messages ?? []).forEach((message, index) => {
    const skip = (reason: string) =>
      skipped.push({ requestChatId: idText(chat._id), index, reason });
    if (!message?._id) return skip('sin _id');
    if (!message.user) return skip('sin autor');
    const createdAt = message.createdAt ?? chat.createdAt;
    if (!createdAt) return skip('sin fecha');
    docs.push({
      _id: message._id,
      requestChatId: chat._id,
      authorId: message.user,
      content: typeof message.content === 'string' ? message.content : '',
      createdAt,
    });
  });
  return { docs, skipped };
}

/** Respuestas del formulario anterior, recortadas y sin las vacías (como la API). */
export function legacyOf(chat: SourceRequestChat): LegacyDoc {
  const legacy: LegacyDoc = {};
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  const howDidYouFindUs = text(chat.whereYouFoundUs);
  const interests = text(chat.interests);
  if (howDidYouFindUs) legacy.howDidYouFindUs = howDidYouFindUs;
  if (interests) legacy.interests = interests;
  return legacy;
}

export interface Counts {
  requestChats: number;
  chatsWithEmbeddedMessages: number;
  embeddedMessages: number;
  chatsToMarkLegacy: number;
  votes: number;
  usersWithAvatarUrl: number;
}

export interface Report {
  database: string;
  applied: boolean;
  before: Counts;
  after?: Counts;
  backup: 'creada' | 'ya existía' | 'pendiente';
  messagesInserted: number;
  messagesAlreadyThere: number;
  skipped: SkippedMessage[];
  legacyMarked: number;
  avatarUrlsRemoved: number;
  check?: {
    backupMessages: number;
    backupMessagesFound: number;
    backupVotes: number;
    currentVotes: number;
    ok: boolean;
  };
}

const sumOfSizes = async <T extends mongo.Document>(
  collection: mongo.Collection<T>,
  field: string,
): Promise<number> => {
  const [row] = await collection
    .aggregate<{
      total: number;
    }>([
      {
        $group: {
          _id: null,
          total: { $sum: { $size: { $ifNull: [`$${field}`, []] } } },
        },
      },
    ])
    .toArray();
  return row?.total ?? 0;
};

async function count(db: mongo.Db): Promise<Counts> {
  const chats = db.collection(REQUEST_CHATS);
  return {
    requestChats: await chats.countDocuments(),
    chatsWithEmbeddedMessages: await chats.countDocuments({
      messages: { $exists: true },
    }),
    embeddedMessages: await sumOfSizes(chats, 'messages'),
    chatsToMarkLegacy: await chats.countDocuments({
      form: { $exists: false },
      legacy: { $exists: false },
    }),
    votes: await sumOfSizes(chats, 'votes'),
    usersWithAvatarUrl: await db
      .collection(USERS)
      .countDocuments({ avatarUrl: { $exists: true } }),
  };
}

const exists = async (db: mongo.Db, name: string) =>
  (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;

/** Compara la copia con el estado actual: mensajes migrados y votos. */
async function verify(db: mongo.Db, skipped: number): Promise<Report['check']> {
  const backup = db.collection<SourceRequestChat>(BACKUP_COLLECTION);
  const messages = db.collection<MessageDoc>(MESSAGES);
  let backupMessages = 0;
  let backupMessagesFound = 0;
  for await (const chat of backup.find(
    {},
    { projection: { _id: 1, messages: 1, createdAt: 1 } },
  )) {
    const { docs } = toMessageDocs(chat);
    backupMessages += docs.length;
    if (docs.length > 0) {
      backupMessagesFound += await messages.countDocuments({
        _id: { $in: docs.map((d) => d._id) },
      });
    }
  }
  const backupVotes = await sumOfSizes(backup, 'votes');
  const ids = await backup.distinct('_id');
  const [row] = await db
    .collection(REQUEST_CHATS)
    .aggregate<{ total: number }>([
      { $match: { _id: { $in: ids } } },
      {
        $group: {
          _id: null,
          total: { $sum: { $size: { $ifNull: ['$votes', []] } } },
        },
      },
    ])
    .toArray();
  const currentVotes = row?.total ?? 0;
  return {
    backupMessages: backupMessages + skipped,
    backupMessagesFound,
    backupVotes,
    currentVotes,
    ok:
      backupMessagesFound === backupMessages &&
      skipped === 0 &&
      backupVotes === currentVotes,
  };
}

/** Corre la migración. Sin `apply` no escribe nada: solo cuenta lo que haría. */
export async function migrate(
  db: mongo.Db,
  { apply }: { apply: boolean },
): Promise<Report> {
  const chats = db.collection<SourceRequestChat>(REQUEST_CHATS);
  const report: Report = {
    database: db.databaseName,
    applied: apply,
    before: await count(db),
    backup: 'pendiente',
    messagesInserted: 0,
    messagesAlreadyThere: 0,
    skipped: [],
    legacyMarked: 0,
    avatarUrlsRemoved: 0,
  };

  if (!apply) {
    for await (const chat of chats.find({ messages: { $exists: true } })) {
      report.skipped.push(...toMessageDocs(chat).skipped);
    }
    return report;
  }

  // 1. Copia de la colección original, una sola vez.
  if (await exists(db, BACKUP_COLLECTION)) {
    report.backup = 'ya existía';
  } else {
    await chats.aggregate([{ $out: BACKUP_COLLECTION }]).toArray();
    report.backup = 'creada';
  }

  // 2. Mensajes embebidos → colección nueva; después se quitan de la solicitud.
  const messages = db.collection<MessageDoc>(MESSAGES);
  for await (const chat of chats.find(
    { messages: { $exists: true } },
    { projection: { _id: 1, createdAt: 1, messages: 1 } },
  )) {
    const { docs, skipped } = toMessageDocs(chat);
    report.skipped.push(...skipped);
    for (let i = 0; i < docs.length; i += BATCH) {
      const result = await messages.bulkWrite(
        docs.slice(i, i + BATCH).map(({ _id, ...rest }) => ({
          updateOne: {
            filter: { _id },
            update: { $setOnInsert: rest },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      report.messagesInserted += result.upsertedCount;
      report.messagesAlreadyThere += result.matchedCount;
    }
    await chats.updateOne({ _id: chat._id }, { $unset: { messages: '' } });
  }

  // 3. Toda solicitud sin formulario queda como `legacy`.
  for await (const chat of chats.find(
    { form: { $exists: false }, legacy: { $exists: false } },
    { projection: { _id: 1, whereYouFoundUs: 1, interests: 1 } },
  )) {
    await chats.updateOne(
      { _id: chat._id, legacy: { $exists: false } },
      {
        $set: { legacy: legacyOf(chat) },
        $unset: { whereYouFoundUs: '', interests: '' },
      },
    );
    report.legacyMarked += 1;
  }

  // 4. Avatares viejos (`file_path` que caduca).
  const avatars = await db
    .collection(USERS)
    .updateMany(
      { avatarUrl: { $exists: true } },
      { $unset: { avatarUrl: '' } },
    );
  report.avatarUrlsRemoved = avatars.modifiedCount;

  report.after = await count(db);
  report.check = await verify(db, report.skipped.length);
  return report;
}

function print(report: Report): void {
  const { before, after } = report;
  const rows: [string, keyof Counts][] = [
    ['solicitudes', 'requestChats'],
    ['solicitudes con mensajes embebidos', 'chatsWithEmbeddedMessages'],
    ['mensajes embebidos', 'embeddedMessages'],
    ['solicitudes sin form ni legacy', 'chatsToMarkLegacy'],
    ['votos', 'votes'],
    ['usuarios con avatarUrl', 'usersWithAvatarUrl'],
  ];
  console.log(
    `Base: ${report.database} · ${report.applied ? 'APLICADA' : 'solo lectura'}\n`,
  );
  console.log(
    '  '.padEnd(40) +
      'antes'.padStart(10) +
      (after ? 'después'.padStart(10) : ''),
  );
  for (const [label, key] of rows) {
    console.log(
      `  ${label}`.padEnd(40) +
        String(before[key]).padStart(10) +
        (after ? String(after[key]).padStart(10) : ''),
    );
  }
  if (report.skipped.length > 0) {
    console.log(
      `\nMensajes que no se pueden migrar (quedan en la copia): ${report.skipped.length}`,
    );
    for (const s of report.skipped.slice(0, 20)) {
      console.log(
        `  solicitud ${s.requestChatId} · mensaje #${s.index}: ${s.reason}`,
      );
    }
  }
  if (!report.applied) {
    console.log(
      '\nPara migrar: repetir con CONFIRM=<base> y --apply (con respaldo previo).',
    );
    return;
  }
  console.log(`\nCopia ${BACKUP_COLLECTION}: ${report.backup}`);
  console.log(
    `Mensajes: ${report.messagesInserted} insertados, ${report.messagesAlreadyThere} ya estaban`,
  );
  console.log(`Solicitudes marcadas legacy: ${report.legacyMarked}`);
  console.log(`avatarUrl quitados: ${report.avatarUrlsRemoved}`);
  const check = report.check!;
  console.log(
    `\nVerificación: mensajes de la copia ${check.backupMessagesFound}/${check.backupMessages} · ` +
      `votos ${check.currentVotes}/${check.backupVotes} → ${check.ok ? 'OK' : 'NO CUADRA'}`,
  );
}

async function main(): Promise<void> {
  const uri = process.env.DB_URI;
  if (!uri) {
    console.error('Falta la variable DB_URI');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const client = new mongo.MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    if (apply && process.env.CONFIRM !== db.databaseName) {
      console.error(`Para aplicar, define CONFIRM=${db.databaseName}.`);
      process.exitCode = 1;
      return;
    }
    const report = await migrate(db, { apply });
    print(report);
    if (report.check && !report.check.ok) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
