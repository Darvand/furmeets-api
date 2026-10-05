/**
 * Datos parecidos a producción para staging (persisten: no se borran al terminar).
 *
 * Uso (desde la raíz del repo):
 *
 *   SEED_DB_URI="mongodb+srv://.../furmeets_development?..." SEED_CONFIRM=furmeets_development npm run seed:staging
 *   ... npm run seed:staging -- --reset    borra lo sembrado antes y vuelve a sembrar
 *   ... npm run seed:staging -- --delete   solo borra lo sembrado
 *
 * Protecciones (staging comparte cluster con producción):
 *   - No usa DB_URI: exige SEED_DB_URI explícita.
 *   - El nombre de la base debe contener dev, staging o test.
 *   - SEED_CONFIRM debe repetir el nombre de la base.
 *   - Si ya hay datos sembrados, no siembra otra vez sin --reset.
 *
 * Volumen (opcional; por defecto entre paréntesis):
 *   SEED_MEMBERS (60) · SEED_IN_PROGRESS (15) · SEED_APPROVED (15) · SEED_REJECTED (10)
 *   SEED_MIN_MESSAGES (10) · SEED_MAX_MESSAGES (120) · SEED_RANDOM_SEED (42)
 *   SEED_GROUP_TELEGRAM_ID: grupo al que se agregan los miembros sembrados. Si falta y en
 *   la base hay exactamente un grupo, se usa ese. Si no hay grupo, abre la App una vez en
 *   staging (lo crea GET /me) y vuelve a correr con --reset.
 *   APPROVE_THRESHOLD (5) · REJECT_THRESHOLD (5): deben coincidir con los de la API.
 *
 * Los usuarios sembrados no pueden iniciar sesión (no tienen initData real). Para medir con
 * `npm run perf:baseline`, usa tu cuenta de prueba y como PERF_CHAT_ID una solicitud
 * sembrada en curso: ninguna llega al umbral, así que se puede votar sin cerrarla.
 */
import { mongo } from 'mongoose';
import {
  countSeeded,
  DEFAULT_SEED_OPTIONS,
  deleteSeed,
  seed,
} from './seed-data';

const ALLOWED_DB_NAME = /dev|staging|test/i;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function numberEnv(name: string, fallback: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    fail(`${name} debe ser un entero mayor o igual a 0.`);
  }
  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const uri =
    env('SEED_DB_URI') ??
    fail('Falta SEED_DB_URI (no se usa DB_URI a propósito).');
  const client = new mongo.MongoClient(uri);
  const db = client.db();
  const dbName = db.databaseName;

  if (!ALLOWED_DB_NAME.test(dbName)) {
    fail(
      `La base "${dbName}" no parece de pruebas (debe contener dev, staging o test). No se toca.`,
    );
  }
  if (env('SEED_CONFIRM') !== dbName) {
    fail(`Para confirmar, define SEED_CONFIRM=${dbName}.`);
  }

  await client.connect();
  try {
    console.log(`Base: ${dbName}`);

    if (args.has('--delete') || args.has('--reset')) {
      const deleted = await deleteSeed(db);
      console.log(
        `Borrado: ${deleted.users} usuarios y ${deleted.requestChats} solicitudes sembradas.`,
      );
      if (args.has('--delete')) return;
    } else if ((await countSeeded(db)) > 0) {
      fail(
        'Ya hay datos sembrados. Usa --reset para regenerarlos o --delete para borrarlos.',
      );
    }

    const groupTelegramId = env('SEED_GROUP_TELEGRAM_ID');
    const result = await seed(db, {
      members: numberEnv('SEED_MEMBERS', DEFAULT_SEED_OPTIONS.members),
      inProgress: numberEnv(
        'SEED_IN_PROGRESS',
        DEFAULT_SEED_OPTIONS.inProgress,
      ),
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
      seed: numberEnv('SEED_RANDOM_SEED', DEFAULT_SEED_OPTIONS.seed),
      approveThreshold: numberEnv(
        'APPROVE_THRESHOLD',
        DEFAULT_SEED_OPTIONS.approveThreshold,
      ),
      rejectThreshold: numberEnv(
        'REJECT_THRESHOLD',
        DEFAULT_SEED_OPTIONS.rejectThreshold,
      ),
      groupTelegramId: groupTelegramId ? Number(groupTelegramId) : undefined,
    });
    console.log(
      `Sembrado: ${result.users} usuarios, ${result.requestChats} solicitudes, ` +
        `${result.messages} mensajes y ${result.votes} votos.`,
    );
    if (!result.addedToGroup) {
      console.warn(
        'No se agregaron miembros al grupo: no hay un único grupo en la base. Abre la App en ' +
          'staging (GET /me lo crea) o define SEED_GROUP_TELEGRAM_ID y corre con --reset.',
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
