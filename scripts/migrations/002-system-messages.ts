/**
 * Migración 002 (T19 · SPEC §3.2): marca como mensajes de sistema (`type: 'system'`) los
 * que escribió el bot antes de T19 (bienvenida y resultado). Desde T19 la API los guarda
 * ya marcados; sin esta migración, los anteriores se verían como mensajes de usuario.
 *
 * Uso (desde la raíz del repo):
 *
 *   DB_URI="mongodb+srv://.../<base>" BOT_TELEGRAM_ID=<id> npm run migrate:002            # solo informa
 *   DB_URI=... BOT_TELEGRAM_ID=<id> CONFIRM=<base> npm run migrate:002 -- --apply         # marca
 *
 * `BOT_TELEGRAM_ID` es el número antes de `:` en el token del bot de esa base (staging y
 * producción tienen bots distintos). Sin `--apply` muestra el usuario del bot encontrado y
 * cuántos mensajes marcaría, para revisarlo antes. Correrla de nuevo no cambia nada: solo
 * toca mensajes sin `type`. No hace falta detener la API.
 */
import { mongo } from 'mongoose';

const MESSAGES = 'requestchatmessages';
const USERS = 'users';

export interface Report {
  database: string;
  applied: boolean;
  /** Usuario del bot en `users`; falta si no existe (entonces no hay nada que marcar). */
  bot?: { name?: string; username?: string };
  /** Mensajes del bot sin `type` antes de migrar. */
  pending: number;
  marked: number;
}

export async function migrate(
  db: mongo.Db,
  { botTelegramId, apply }: { botTelegramId: number; apply: boolean },
): Promise<Report> {
  const report: Report = {
    database: db.databaseName,
    applied: apply,
    pending: 0,
    marked: 0,
  };
  const bot = await db.collection(USERS).findOne<{
    _id: mongo.Binary;
    name?: string;
    username?: string;
  }>({ telegramId: botTelegramId }, { projection: { name: 1, username: 1 } });
  if (!bot) {
    return report;
  }
  report.bot = { name: bot.name, username: bot.username };
  const filter = { authorId: bot._id, type: { $exists: false } };
  const messages = db.collection(MESSAGES);
  report.pending = await messages.countDocuments(filter);
  if (apply) {
    const result = await messages.updateMany(filter, {
      $set: { type: 'system' },
    });
    report.marked = result.modifiedCount;
  }
  return report;
}

function print(report: Report): void {
  console.log(
    `Base: ${report.database} · ${report.applied ? 'APLICADA' : 'solo lectura'}`,
  );
  if (!report.bot) {
    console.log('No hay un usuario con ese BOT_TELEGRAM_ID: nada que marcar.');
    return;
  }
  console.log(
    `Bot: ${report.bot.name ?? '(sin nombre)'} (@${report.bot.username ?? '?'})`,
  );
  console.log(`Mensajes del bot sin marcar: ${report.pending}`);
  if (report.applied) {
    console.log(`Marcados como sistema: ${report.marked}`);
  } else {
    console.log('\nPara marcar: repetir con CONFIRM=<base> y --apply.');
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
    print(await migrate(db, { botTelegramId, apply }));
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
