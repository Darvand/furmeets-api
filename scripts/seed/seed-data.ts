/**
 * Generación de datos parecidos a producción para staging (sin Nest).
 *
 * Escribe directamente en las colecciones con la misma forma que los schemas de Mongoose
 * (`users`, `groups`, `requestchats`, `requestchatmessages`). Los usuarios sembrados usan `telegramId` desde
 * `SEED_TELEGRAM_ID_BASE`, fuera del rango de Telegram, y usernames `seed_*`: así no chocan
 * con cuentas reales y se pueden borrar sin tocar nada más (`deleteSeed`).
 *
 * `test/seed.e2e-spec.ts` comprueba que la API lee estos datos, para que el script no se
 * desfase de los schemas.
 */
import { randomUUID } from 'crypto';
import { mongo } from 'mongoose';

/** Primer `telegramId` sembrado. Los ids reales de Telegram están muy por debajo. */
export const SEED_TELEGRAM_ID_BASE = 7_000_000_000_000;
const SEED_TELEGRAM_ID_MAX = SEED_TELEGRAM_ID_BASE + 1_000_000;

export interface SeedOptions {
  members: number;
  inProgress: number;
  approved: number;
  rejected: number;
  minMessages: number;
  maxMessages: number;
  /** Semilla del generador aleatorio: misma semilla, mismos datos. */
  seed: number;
  /** `telegramId` del grupo al que se agregan los miembros sembrados (si existe). */
  groupTelegramId?: number;
  /** Umbrales de votos de la API (por defecto 5 aprobaciones / 3 rechazos). */
  approveThreshold: number;
  rejectThreshold: number;
  now?: Date;
}

export const DEFAULT_SEED_OPTIONS: SeedOptions = {
  members: 60,
  inProgress: 15,
  approved: 15,
  rejected: 10,
  minMessages: 10,
  maxMessages: 120,
  seed: 42,
  approveThreshold: 5,
  rejectThreshold: 5,
};

export interface SeedResult {
  users: number;
  requestChats: number;
  messages: number;
  votes: number;
  addedToGroup: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const FIRST_NAMES = [
  'Ana',
  'Beto',
  'Caro',
  'Dani',
  'Eli',
  'Fede',
  'Gabi',
  'Hugo',
  'Isa',
  'Juan',
  'Kiara',
  'Leo',
  'Mia',
  'Nico',
  'Olga',
  'Pablo',
  'Quique',
  'Rosa',
  'Sofi',
  'Tomás',
  'Uriel',
  'Vale',
  'Wendy',
  'Ximena',
  'Yago',
  'Zoe',
];
const LAST_NAMES = [
  'Gómez',
  'Pérez',
  'Ruiz',
  'Díaz',
  'Castro',
  'Rojas',
  'Mora',
  'Vega',
  'Ríos',
  'Luna',
];
const SPECIES = [
  'Bird',
  'Feline',
  'Canine',
  'Dragon',
  'Deer',
  'Bunny',
  'Wolf',
  'Other',
];
const WHERE = [
  'Por Facebook',
  'Un amigo me invitó',
  'Instagram',
  'En una convención',
  'TikTok',
  'Buscando en Telegram',
];
const INTERESTS = [
  'Me gustan los videojuegos y dibujar',
  'Fursuits, convenciones y salir a pasear',
  'Arte digital, música y juegos de mesa',
  'Conocer gente nueva de la comunidad',
  'Escribir historias y hacer cosplay',
];
const REQUESTER_LINES = [
  '¡Hola a todos! Soy nuevo en la comunidad y me encantaría conocerlos.',
  'Mi fursona es un lobo gris, la diseñé hace un par de años.',
  'Me enteré del grupo por un amigo que ya está aquí.',
  'Me gusta dibujar, a veces hago comisiones pequeñas.',
  '¿Hacen reuniones presenciales seguido?',
  'Gracias por la bienvenida, todos son muy amables 😊',
  'Vivo en la ciudad, así que podría ir a las juntas.',
  'Sí, he ido a dos convenciones, la última fue increíble.',
  'Prefiero los juegos cooperativos, pero me apunto a lo que sea.',
  'Claro, leí las reglas y estoy de acuerdo con todo.',
];
const MEMBER_LINES = [
  '¡Bienvenido! Cuéntanos un poco de ti.',
  '¿Cómo nos encontraste?',
  '¿Cuál es tu fursona?',
  'Qué buena onda, aquí hacemos juntas casi cada mes.',
  '¿Ya leíste las reglas del grupo?',
  'Me late, yo también dibujo de vez en cuando.',
  '¿Tienes redes donde podamos ver tu arte?',
  'Perfecto, cualquier duda nos dices.',
  'Jaja, sí, la última convención estuvo buenísima.',
  '¡Suerte con la solicitud!',
];

/** Generador aleatorio con semilla (mulberry32): mismos datos en cada corrida. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const sample = <T>(items: readonly T[], count: number): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
  };
  return { next, int, pick, sample };
}

type Random = ReturnType<typeof createRandom>;

/** UUID como lo guarda Mongoose (`Schema.Types.UUID` → Binary subtipo 4). */
const uuid = () => new mongo.UUID(randomUUID());

interface SeedUser {
  _id: mongo.UUID;
  telegramId: number;
  name: string;
  username: string;
  isMember: boolean;
  species?: string;
  createdAt: Date;
}

function buildUser(
  random: Random,
  index: number,
  isMember: boolean,
  createdAt: Date,
): SeedUser {
  const first = random.pick(FIRST_NAMES);
  const withLastName = random.next() < 0.6;
  return {
    _id: uuid(),
    telegramId: SEED_TELEGRAM_ID_BASE + index,
    name: withLastName ? `${first} ${random.pick(LAST_NAMES)}` : first,
    username: `seed_${first
      .toLowerCase()
      .normalize('NFD')
      .replace(/[^a-z]/g, '')}_${index}`,
    isMember,
    ...(random.next() < 0.7 ? { species: random.pick(SPECIES) } : {}),
    createdAt,
  };
}

function buildVotes(
  random: Random,
  members: SeedUser[],
  state: string,
  options: SeedOptions,
  from: Date,
  to: Date,
) {
  let approves: number;
  let rejects: number;
  if (state === 'Approved') {
    approves = options.approveThreshold;
    rejects = random.int(0, options.rejectThreshold - 1);
  } else if (state === 'Rejected') {
    approves = random.int(0, options.approveThreshold - 1);
    rejects = options.rejectThreshold;
  } else {
    // En curso: por debajo de ambos umbrales (deja margen para votar en las pruebas).
    approves = random.int(0, Math.max(0, options.approveThreshold - 2));
    rejects = random.int(0, Math.max(0, options.rejectThreshold - 2));
  }
  const voters = random.sample(members, approves + rejects);
  return voters.map((member, i) => {
    const createdAt = new Date(
      from.getTime() + random.next() * (to.getTime() - from.getTime()),
    );
    return {
      _id: new mongo.ObjectId(),
      from: member._id,
      type: i < approves ? 'approve' : 'reject',
      createdAt,
      updatedAt: createdAt,
    };
  });
}

function buildMessages(
  random: Random,
  requestChatId: mongo.UUID,
  requester: SeedUser,
  members: SeedUser[],
  count: number,
  from: Date,
  to: Date,
) {
  // Un grupo de miembros conversa con el solicitante.
  const talkers = random.sample(
    members,
    random.int(2, Math.min(8, members.length)),
  );
  const step = (to.getTime() - from.getTime()) / Math.max(1, count);
  return Array.from({ length: count }, (_, i) => {
    const byRequester = i === 0 || random.next() < 0.4;
    const author = byRequester ? requester : random.pick(talkers);
    return {
      _id: uuid(),
      requestChatId,
      authorId: author._id,
      content: random.pick(byRequester ? REQUESTER_LINES : MEMBER_LINES),
      createdAt: new Date(
        from.getTime() + step * i + random.next() * step * 0.8,
      ),
    };
  });
}

/**
 * Forma de los documentos que toca el seed. El driver tipa `_id` como `ObjectId` por
 * defecto; aquí los `_id` y las referencias son UUID, como los guarda Mongoose.
 */
interface SeedRequestChat {
  _id: mongo.UUID;
  requester: mongo.UUID;
  /** Respuestas del formulario anterior: las solicitudes sembradas son de ese tipo. */
  legacy: { howDidYouFindUs?: string; interests?: string };
  votes: ReturnType<typeof buildVotes>;
  state: string;
  createdAt: Date;
  updatedAt: Date;
}

interface SeedGroup {
  _id: mongo.UUID;
  telegramId: number;
  members: mongo.UUID[];
}

const usersOf = (db: mongo.Db) => db.collection<SeedUser>('users');
const requestChatsOf = (db: mongo.Db) =>
  db.collection<SeedRequestChat>('requestchats');
const groupsOf = (db: mongo.Db) => db.collection<SeedGroup>('groups');
type SeedMessage = ReturnType<typeof buildMessages>[number];
const messagesOf = (db: mongo.Db) =>
  db.collection<SeedMessage>('requestchatmessages');

/** Inserta usuarios, solicitudes (con votos), sus mensajes y agrega miembros al grupo. */
export async function seed(
  db: mongo.Db,
  overrides: Partial<SeedOptions> = {},
): Promise<SeedResult> {
  const options = { ...DEFAULT_SEED_OPTIONS, ...overrides };
  const random = createRandom(options.seed);
  const now = options.now ?? new Date();
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const members = Array.from({ length: options.members }, (_, i) =>
    buildUser(random, i, true, ago(random.int(200, 400))),
  );

  const states = [
    ...Array<string>(options.inProgress).fill('InProgress'),
    ...Array<string>(options.approved).fill('Approved'),
    ...Array<string>(options.rejected).fill('Rejected'),
  ];
  const applicants: SeedUser[] = [];
  const messages: SeedMessage[] = [];
  const requestChats = states.map((state, i): SeedRequestChat => {
    // En curso: últimas 2 semanas; cerradas: los 6 meses anteriores.
    const createdAt =
      state === 'InProgress'
        ? ago(random.int(0, 14) + random.next())
        : ago(random.int(15, 180));
    const closesAt =
      state === 'InProgress'
        ? now
        : new Date(createdAt.getTime() + random.int(1, 10) * DAY_MS);
    // Un solicitante aprobado ya entró al grupo.
    const requester = buildUser(
      random,
      options.members + i,
      state === 'Approved',
      createdAt,
    );
    applicants.push(requester);
    const requestChatId = uuid();
    const chatMessages = buildMessages(
      random,
      requestChatId,
      requester,
      members,
      random.int(options.minMessages, options.maxMessages),
      createdAt,
      closesAt,
    );
    messages.push(...chatMessages);
    const updatedAt = chatMessages.at(-1)?.createdAt ?? createdAt;
    return {
      _id: requestChatId,
      requester: requester._id,
      legacy: {
        ...(random.next() < 0.8 ? { howDidYouFindUs: random.pick(WHERE) } : {}),
        ...(random.next() < 0.8 ? { interests: random.pick(INTERESTS) } : {}),
      },
      votes: buildVotes(random, members, state, options, createdAt, closesAt),
      state,
      createdAt,
      updatedAt,
    };
  });

  const users = [...members, ...applicants];
  await usersOf(db).insertMany(users);
  if (requestChats.length > 0) {
    await requestChatsOf(db).insertMany(requestChats);
  }
  if (messages.length > 0) {
    await messagesOf(db).insertMany(messages);
  }

  const groupMembers = users.filter((u) => u.isMember).map((u) => u._id);
  const groupFilter =
    options.groupTelegramId !== undefined
      ? { telegramId: options.groupTelegramId }
      : {};
  const groups = await groupsOf(db)
    .find(groupFilter, { projection: { _id: 1 } })
    .limit(2)
    .toArray();
  const addedToGroup = groups.length === 1;
  if (addedToGroup) {
    await groupsOf(db).updateOne(
      { _id: groups[0]._id },
      { $addToSet: { members: { $each: groupMembers } } },
    );
  }

  return {
    users: users.length,
    requestChats: requestChats.length,
    messages: messages.length,
    votes: requestChats.reduce((sum, chat) => sum + chat.votes.length, 0),
    addedToGroup,
  };
}

/** Borra solo lo sembrado: usuarios del rango, sus solicitudes y mensajes, y su membresía en el grupo. */
export async function deleteSeed(
  db: mongo.Db,
): Promise<{ users: number; requestChats: number }> {
  const range = {
    telegramId: { $gte: SEED_TELEGRAM_ID_BASE, $lt: SEED_TELEGRAM_ID_MAX },
  };
  const seeded = await usersOf(db)
    .find(range, { projection: { _id: 1 } })
    .toArray();
  const ids = seeded.map((u) => u._id);
  if (ids.length === 0) {
    return { users: 0, requestChats: 0 };
  }
  const chatIds = (
    await requestChatsOf(db)
      .find({ requester: { $in: ids } }, { projection: { _id: 1 } })
      .toArray()
  ).map((chat) => chat._id);
  await messagesOf(db).deleteMany({ requestChatId: { $in: chatIds } });
  const chats = await requestChatsOf(db).deleteMany({
    _id: { $in: chatIds },
  });
  // $pullAll equivale a $pull con $in para valores exactos, y el driver sí lo tipa con UUID.
  await groupsOf(db).updateMany({}, { $pullAll: { members: ids } });
  const users = await usersOf(db).deleteMany(range);
  return { users: users.deletedCount, requestChats: chats.deletedCount };
}

export async function countSeeded(db: mongo.Db): Promise<number> {
  return usersOf(db).countDocuments({
    telegramId: { $gte: SEED_TELEGRAM_ID_BASE, $lt: SEED_TELEGRAM_ID_MAX },
  });
}
