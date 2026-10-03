/**
 * Línea base de latencia (T37 · RNF-OBS-03, RNF-REN-07).
 *
 * Mide contra un servidor ya desplegado (staging) los cuatro escenarios de la App y
 * reporta p50 y p95 de cada uno:
 *
 *   - arranque:   lo que hace la App al abrirse (`App.tsx` + `IndexPage.tsx`): 4 peticiones
 *                 en serie, luego 2 peticiones y la conexión del socket en paralelo.
 *   - abrir chat: `RequestChatPage.tsx`: `GET /request-chats/:id` + conexión del socket.
 *   - enviar:     emitir `request-chat` por el socket hasta recibir el mensaje de vuelta.
 *   - votar:      `PUT /request-chats/:id/vote/:type`.
 *
 * Uso (desde la raíz del repo):
 *
 *   PERF_BASE_URL=https://<api-staging> PERF_TELEGRAM_ID=<id> npm run perf:baseline
 *
 * Variables de entorno:
 *
 *   PERF_BASE_URL     (obligatoria) URL base de la API, sin `/` final.
 *   PERF_TELEGRAM_ID  (obligatoria) telegramId de un usuario de prueba ya registrado y
 *                     miembro del grupo. Se envía como `x-telegram-id`, que solo leen los
 *                     servidores anteriores a T03 (para medir la línea base).
 *   PERF_INIT_DATA    initData firmado del mismo usuario; se envía como
 *                     `Authorization: tma <initData>`. Obligatorio contra servidores con T03
 *                     (sin él todo responde 401). Vence a las 24 h.
 *   PERF_CHAT_ID      (opcional) UUID del chat de solicitud a usar. Si falta, abrir chat usa
 *                     el primero de la lista y enviar/votar se omiten.
 *   PERF_WRITES=1     (opcional) habilita enviar y votar, que escriben en la BD y mandan
 *                     mensajes reales por Telegram. Sin esta variable solo se hacen lecturas.
 *   PERF_VOTE_TYPE    (opcional) `approve` (por defecto) o `reject`.
 *   PERF_ITERATIONS   (opcional) repeticiones por escenario; 10 por defecto.
 *   PERF_TIMEOUT_MS   (opcional) límite por petición, conexión de socket y mensaje; 30000
 *                     por defecto. Subirlo si alguna ruta tarda más (p. ej. la lista antes
 *                     de T40).
 *
 * Un socket que no conecta en el arranque o al abrir chat no detiene la corrida: cuenta
 * como fallo y se reporta junto al escenario (el tiempo del escenario se mide igual).
 *
 * Cuidado con PERF_WRITES=1: usar un chat de prueba en estado `InProgress`, en el que el
 * usuario aún no haya votado y al que le falten al menos 2 votos para el umbral. El voto
 * del mismo tipo se alterna (votar dos veces lo quita), así que el script vota un número
 * par de veces y deja el chat como estaba; si un voto cerrara el chat, se detiene. Cada
 * mensaje enviado notifica por Telegram (al grupo si el usuario es el solicitante, o al
 * solicitante si no lo es).
 *
 * Antes de medir, el script hace una petición de calentamiento para que el servidor esté
 * despierto (Render duerme tras 15 min sin tráfico): la línea base es con servidor despierto.
 * Para ver dónde se va el tiempo (Mongo / Telegram), revisar las líneas `Timing` de los logs
 * del servidor durante la corrida.
 */
import { io, Socket } from 'socket.io-client';

type Sample = { name: string; ms: number };

function env(name: string, required = false): string | undefined {
  const value = process.env[name]?.trim();
  if (required && !value) {
    console.error(
      `Falta la variable de entorno ${name}. Ver el comentario al inicio del script.`,
    );
    process.exit(1);
  }
  return value || undefined;
}

const BASE_URL = env('PERF_BASE_URL', true)!.replace(/\/+$/, '');
const TELEGRAM_ID = env('PERF_TELEGRAM_ID', true)!;
const INIT_DATA = env('PERF_INIT_DATA');
const CHAT_ID = env('PERF_CHAT_ID');
const WRITES = env('PERF_WRITES') === '1';
const VOTE_TYPE = env('PERF_VOTE_TYPE') ?? 'approve';
const ITERATIONS = Math.max(1, Number(env('PERF_ITERATIONS') ?? 10));
const TIMEOUT_MS = Math.max(1_000, Number(env('PERF_TIMEOUT_MS') ?? 30_000));

if (VOTE_TYPE !== 'approve' && VOTE_TYPE !== 'reject') {
  console.error('PERF_VOTE_TYPE debe ser "approve" o "reject".');
  process.exit(1);
}

const now = () => performance.now();

async function http<T = unknown>(
  method: string,
  path: string,
): Promise<{ ms: number; body: T }> {
  const headers: Record<string, string> = { 'x-telegram-id': TELEGRAM_ID };
  if (INIT_DATA) headers.authorization = `tma ${INIT_DATA}`;
  const startedAt = now();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  const ms = now() - startedAt;
  if (!res.ok) {
    throw new Error(`${method} ${path} respondió ${res.status}`);
  }
  return { ms, body: (text ? JSON.parse(text) : undefined) as T };
}

function connectSocket(): Promise<{ ms: number; socket: Socket }> {
  const startedAt = now();
  const socket = io(BASE_URL, {
    forceNew: true,
    reconnection: false,
    timeout: TIMEOUT_MS,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve({ ms: now() - startedAt, socket }));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(new Error(`No se pudo conectar el socket: ${error.message}`));
    });
  });
}

const BOOTSTRAP = 'arranque (6 HTTP + 1 socket)';
const OPEN_CHAT = 'abrir chat';
const SEND = 'enviar mensaje';

/** Fallos de conexión del socket por escenario: no detienen la corrida, se reportan al final. */
const socketFailures = new Map<string, string[]>();

/** Como `connectSocket`, pero un fallo se anota en `socketFailures` y devuelve `null`. */
async function tryConnectSocket(
  scenario: string,
): Promise<{ ms: number; socket: Socket } | null> {
  try {
    return await connectSocket();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    socketFailures.set(scenario, [
      ...(socketFailures.get(scenario) ?? []),
      message,
    ]);
    return null;
  }
}

/** App.tsx: sync → lista → grupo → usuario, en serie; luego IndexPage: lista, usuario y socket en paralelo. */
async function bootstrap(steps: Sample[]): Promise<number> {
  const startedAt = now();
  for (const [method, path, name] of [
    ['POST', '/groups/sync', 'POST /groups/sync'],
    ['GET', '/request-chats', 'GET /request-chats'],
    ['GET', '/groups', 'GET /groups'],
    ['GET', `/users/${TELEGRAM_ID}`, 'GET /users/:telegramId'],
  ]) {
    const { ms } = await http(method, path);
    steps.push({ name, ms });
  }
  const [list, user, connection] = await Promise.all([
    http('GET', '/request-chats'),
    http('GET', `/users/${TELEGRAM_ID}`),
    tryConnectSocket(BOOTSTRAP),
  ]);
  const total = now() - startedAt;
  connection?.socket.close();
  steps.push({ name: 'GET /request-chats (IndexPage)', ms: list.ms });
  steps.push({ name: 'GET /users/:telegramId (IndexPage)', ms: user.ms });
  if (connection) steps.push({ name: 'socket connect', ms: connection.ms });
  return total;
}

async function openChat(chatId: string): Promise<number> {
  const startedAt = now();
  const [, connection] = await Promise.all([
    http('GET', `/request-chats/${chatId}`),
    tryConnectSocket(OPEN_CHAT),
  ]);
  const total = now() - startedAt;
  connection?.socket.close();
  return total;
}

function sendMessage(
  socket: Socket,
  chatId: string,
  userUUID: string,
  i: number,
): Promise<number> {
  const content = `[perf T37] mensaje ${i + 1} ${Date.now()}`;
  return new Promise((resolve, reject) => {
    const startedAt = now();
    const timer = setTimeout(() => {
      socket.off('request-chat', onMessage);
      reject(new Error('El mensaje no volvió por el socket a tiempo'));
    }, TIMEOUT_MS);
    const onMessage = (message: { content?: string }) => {
      if (message?.content !== content) return;
      clearTimeout(timer);
      socket.off('request-chat', onMessage);
      resolve(now() - startedAt);
    };
    socket.on('request-chat', onMessage);
    socket.emit('request-chat', { requestChatUUID: chatId, userUUID, content });
  });
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

type Stats = { n: number; p50: number; p95: number; min: number; max: number };

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

const fmt = (ms: number) => `${Math.round(ms)} ms`;

function printTable(
  title: string,
  rows: [string, number[]][],
): Map<string, Stats> {
  const result = new Map<string, Stats>();
  console.log(`\n${title}`);
  console.log(
    '  escenario'.padEnd(40) +
      'n'.padStart(4) +
      'p50'.padStart(10) +
      'p95'.padStart(10) +
      'min'.padStart(10) +
      'max'.padStart(10),
  );
  for (const [name, values] of rows) {
    if (values.length === 0) {
      console.log(`  ${name}`.padEnd(40) + '   — omitido');
      continue;
    }
    const s = stats(values);
    result.set(name, s);
    console.log(
      `  ${name}`.padEnd(40) +
        String(s.n).padStart(4) +
        fmt(s.p50).padStart(10) +
        fmt(s.p95).padStart(10) +
        fmt(s.min).padStart(10) +
        fmt(s.max).padStart(10),
    );
  }
  return result;
}

async function main(): Promise<void> {
  console.log(
    `Midiendo ${BASE_URL} · ${ITERATIONS} repeticiones por escenario`,
  );

  const warmup = await http('GET', '/groups');
  console.log(`Calentamiento: GET /groups en ${fmt(warmup.ms)}`);

  const { body: me } = await http<{ uuid: string }>(
    'GET',
    `/users/${TELEGRAM_ID}`,
  );
  const { body: list } = await http<{ items: { uuid: string }[] }>(
    'GET',
    '/request-chats',
  );
  const chatId = CHAT_ID ?? list.items[0]?.uuid;

  const bootstrapTimes: number[] = [];
  const bootstrapSteps: Sample[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    bootstrapTimes.push(await bootstrap(bootstrapSteps));
  }

  const openTimes: number[] = [];
  if (chatId) {
    for (let i = 0; i < ITERATIONS; i++) {
      openTimes.push(await openChat(chatId));
    }
  } else {
    console.warn('No hay chats de solicitud: se omite abrir chat.');
  }

  const sendTimes: number[] = [];
  const voteTimes: number[] = [];
  if (WRITES && CHAT_ID) {
    const { body: chat } = await http<{ state: string; userVote?: string }>(
      'GET',
      `/request-chats/${CHAT_ID}`,
    );
    if (chat.state !== 'InProgress') {
      throw new Error(
        `El chat ${CHAT_ID} no está en curso (${chat.state}); no se puede enviar ni votar.`,
      );
    }
    if (chat.userVote) {
      throw new Error(
        'El usuario de prueba ya votó en este chat; quitar el voto o usar otro chat.',
      );
    }

    const connection = await tryConnectSocket(SEND);
    if (connection) {
      try {
        for (let i = 0; i < ITERATIONS; i++) {
          sendTimes.push(
            await sendMessage(connection.socket, CHAT_ID, me.uuid, i),
          );
        }
      } finally {
        connection.socket.close();
      }
    } else {
      console.warn('El socket no conectó: se omite enviar.');
    }

    // Número par de votos: votar dos veces el mismo tipo lo quita, así el chat queda igual.
    const votes = ITERATIONS % 2 === 0 ? ITERATIONS : ITERATIONS + 1;
    for (let i = 0; i < votes; i++) {
      const { ms, body } = await http<{ state: string }>(
        'PUT',
        `/request-chats/${CHAT_ID}/vote/${VOTE_TYPE}`,
      );
      voteTimes.push(ms);
      if (body.state !== 'InProgress') {
        console.warn(
          `El voto cerró el chat (${body.state}). Se detienen los votos.`,
        );
        break;
      }
    }
  } else {
    console.warn(
      'Enviar y votar omitidos: requieren PERF_CHAT_ID y PERF_WRITES=1.',
    );
  }

  const summary = printTable('Resultados (servidor despierto)', [
    [BOOTSTRAP, bootstrapTimes],
    [OPEN_CHAT, openTimes],
    [SEND, sendTimes],
    ['votar', voteTimes],
  ]);

  const byStep = new Map<string, number[]>();
  for (const { name, ms } of bootstrapSteps) {
    byStep.set(name, [...(byStep.get(name) ?? []), ms]);
  }
  printTable('Detalle del arranque, por petición', [...byStep.entries()]);

  const attempts = new Map([
    [BOOTSTRAP, bootstrapTimes.length],
    [OPEN_CHAT, openTimes.length],
    [SEND, 1],
  ]);
  if (socketFailures.size > 0) {
    console.log('\nSockets que no conectaron');
    for (const [scenario, errors] of socketFailures) {
      const counts = new Map<string, number>();
      for (const e of errors) counts.set(e, (counts.get(e) ?? 0) + 1);
      const detail = [...counts].map(([e, n]) => `${n}× ${e}`).join('; ');
      console.log(
        `  ${scenario}`.padEnd(40) +
          `${errors.length}/${attempts.get(scenario)} · ${detail}`,
      );
    }
  }

  const cell = (name: string) => {
    const s = summary.get(name);
    const failed = socketFailures.get(name)?.length;
    const failures = failed
      ? ` (socket falló ${failed}/${attempts.get(name)})`
      : '';
    return (s ? `${fmt(s.p50)} / ${fmt(s.p95)}` : '—') + failures;
  };
  const date = new Date().toISOString().slice(0, 10);
  console.log('\nLínea para todo.md (p50 / p95):');
  console.log(
    `**Línea base (${date}, n=${ITERATIONS}, p50 / p95):** arranque ${cell(BOOTSTRAP)} · ` +
      `abrir chat ${cell(OPEN_CHAT)} · enviar ${cell(SEND)} · votar ${cell('votar')}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
