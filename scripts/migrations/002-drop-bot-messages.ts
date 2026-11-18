/**
 * Migración 002 (T19 · SPEC §3.2): quita del chat los mensajes que escribió el bot
 * (bienvenida, aprobada, rechazada). Desde T19 el bot no escribe en el chat: la App
 * muestra la bienvenida como encabezado y el resultado en su propia pantalla.
 *
 * Uso (desde la raíz del repo):
 *
 *   DB_URI="mongodb+srv://.../<base>" BOT_TELEGRAM_ID=<id> npm run migrate:002            # solo informa
 *   DB_URI=... BOT_TELEGRAM_ID=<id> CONFIRM=<base> npm run migrate:002 -- --apply         # quita
 *
 * `BOT_TELEGRAM_ID` es el número antes de `:` en el token del bot de esa base (staging y
 * producción tienen bots distintos). Sin `--apply` muestra el usuario del bot encontrado y
 * cuántos mensajes quitaría, para revisarlo antes.
 *
 * Con `--apply`, primero copia esos mensajes en `requestchatmessages_bot_pre_002` (sin
 * duplicar si ya estaban) y después los borra de `requestchatmessages`. Correrla de nuevo
 * no cambia nada. No hace falta detener la API: desde T19 no crea mensajes del bot.
 */
import { mongo } from 'mongoose';

export const BACKUP_COLLECTION = 'requestchatmessages_bot_pre_002';
const MESSAGES = 'requestchatmessages';
const USERS = 'users';

type Doc = mongo.Document & { _id: mongo.Binary };

export interface Report {
  database: string;
  applied: boolean;
  /** Usuario del bot en `users`; falta si no existe (entonces no hay nada que quitar). */
  bot?: { name?: string; username?: string };
  /** Mensajes del bot en el chat antes de migrar. */
  found: number;
  backedUp: number;
  deleted: number;
}

export async function migrate(
  db: mongo.Db,
  { botTelegramId, apply }: { botTelegramId: number; apply: boolean },
): Promise<Report> {
  const report: Report = {
    database: db.databaseName,
    applied: apply,
    found: 0,
    backedUp: 0,
    deleted: 0,
  };
  const bot = await db
    .collection(USERS)
    .findOne<
      Doc & { name?: string; username?: string }
    >({ telegramId: botTelegramId }, { projection: { name: 1, username: 1 } });
  if (!bot) {
    return report;
  }
  report.bot = { name: bot.name, username: bot.username };
  const filter = { authorId: bot._id };
  const messages = db.collection<Doc>(MESSAGES);
  report.found = await messages.countDocuments(filter);
  if (!apply || report.found === 0) {
    return report;
  }
  const docs = await messages.find(filter).toArray();
  const backup = await db.collection<Doc>(BACKUP_COLLECTION).bulkWrite(
    docs.map((doc) => ({
      replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
    })),
  );
  report.backedUp = backup.upsertedCount + backup.matchedCount;
  // Solo se borra lo que quedó respaldado.
  const result = await messages.deleteMany({
    _id: { $in: docs.map((doc) => doc._id) },
  });
  report.deleted = result.deletedCount;
  return report;
}

function print(report: Report): void {
  console.log(
    `Base: ${report.database} · ${report.applied ? 'APLICADA' : 'solo lectura'}`,
  );
  if (!report.bot) {
    console.log('No hay un usuario con ese BOT_TELEGRAM_ID: nada que quitar.');
    return;
  }
  console.log(
    `Bot: ${report.bot.name ?? '(sin nombre)'} (@${report.bot.username ?? '?'})`,
  );
  console.log(`Mensajes del bot en el chat: ${report.found}`);
  if (report.applied) {
    console.log(
      `Respaldados en ${BACKUP_COLLECTION}: ${report.backedUp} · borrados: ${report.deleted}`,
    );
  } else {
    console.log('\nPara quitarlos: repetir con CONFIRM=<base> y --apply.');
  }
}

async function main(): Promise<void> {
  const uri = process.env.DB_URI;
  const botTelegramId = Number(process.env.BOT_TELEGRAM_ID);
  if (!uri || !Number.isInteger(botTelegramId) || botTelegramId <= 0) {
    console.error('Faltan DB_URI o BOT_TELEGRAM_ID (número)');
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
    const report = await migrate(db, { botTelegramId, apply });
    print(report);
    if (report.applied && report.deleted !== report.found) process.exitCode = 1;
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
