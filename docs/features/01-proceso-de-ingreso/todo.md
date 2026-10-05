# Tareas: Funcionalidad 01 — Proceso de ingreso

> Plan y requerimientos no funcionales: [plan.md](plan.md). Requisitos: [SPEC.md](../../../SPEC.md).
> **API** = `furmeets-api` · **App** = `furmeets-mini-app`.
>
> Verificación estándar (se asume en todas las tareas además de la propia):
> - API: `npm run lint` · `npm run build` · `npm test` (y `npm run test:e2e` cuando aplique)
> - App: `npm run lint` · `npm run build`

---

## Fase 0 — Seguridad, datos y latencia

> Las tareas aparecen en orden de ejecución. T37–T43 son las de latencia (el porqué está en la tabla de causas de [plan.md](plan.md)); los IDs anteriores se mantienen.

## Task 01: Revocar el token del bot y rotar secretos

**Repo:** operación (manual) · **RNF:** SEG-03, SEG-08

**Description:** El token actual está publicado en el bundle de la App. Revocarlo con @BotFather (`/revoke`) para prod y staging, cargar el nuevo solo en Render y quitar `VITE_TELEGRAM_BOT_TOKEN` de los secretos de Vercel y GitHub.

**Acceptance criteria:**
- [x] El token anterior ya no responde (`getMe` → 401)
- [x] El token nuevo solo existe en las variables de Render (API) y en `.env` local
- [x] No hay `VITE_TELEGRAM_BOT_TOKEN` en Vercel ni en GitHub

**Verification:**
- [x] Manual: `curl https://api.telegram.org/bot<viejo>/getMe` falla; el bot sigue respondiendo con el nuevo. Token revocado y rotado en staging y en producción (confirmado el 2026-10-03).

**Dependencies:** None

**Files likely touched:** ninguno (configuración externa)

**Estimated scope:** XS

---

## Task 37: Línea base de latencia

**Repo:** API · **RNF:** OBS-03, REN-07

**Description:** Medir antes de optimizar. Un interceptor global registra la duración de cada ruta HTTP y un wrapper hace lo mismo con cada evento de socket, separando el tiempo de Mongo y de Telegram cuando sea posible. Un script mide, contra staging con el servidor despierto, el arranque de la App (peticiones y tiempo total), abrir un chat, enviar un mensaje y votar. Los números actuales se anotan en este documento como línea base.

**Acceptance criteria:**
- [x] Cada petición y evento deja una línea de log con ruta/evento y duración en ms (sin datos personales)
- [x] El script reporta p50 y p95 de arranque, abrir chat, enviar y votar
- [x] La línea base queda anotada abajo, con fecha

**Verification:**
- [x] Correr el script dos veces en staging y obtener números consistentes

**Dependencies:** None

**Files likely touched:**
- `src/shared/interceptors/timing.interceptor.ts`
- `src/chat/presentation/chat.gateway.ts`
- `src/main.ts`
- `scripts/perf/latency-baseline.ts`

**Estimated scope:** S

**Línea base (2026-10-03, staging con el código de `main`, servidor despierto, 2 corridas de n=3, p50 / p95):**

| Escenario | Corrida 1 | Corrida 2 |
|---|---|---|
| arranque (6 HTTP + 1 socket) | 54683 / 57999 ms | 53900 / 55383 ms |
| abrir chat | 433 / 452 ms | 478 / 582 ms |
| enviar | 948 / 1029 ms | 904 / 918 ms |
| votar | 620 / 673 ms | 612 / 627 ms |

Casi todo el arranque son las dos `GET /request-chats` (24–28 s cada una, con 41 chats); `POST /groups/sync` ~2.3 s; el resto < 0.6 s. En corridas anteriores con el límite de 30 s, el socket del arranque falló (`xhr post error`) mientras el servidor armaba la lista, y lo mismo pasó en producción; en estas dos corridas conectó las 6 veces. Producción no se midió completa: el arranque no termina con el límite de 30 s y no se quiso cargarla más.

**Medición tras T38–T42 (2026-10-03, staging con `development`, servidor despierto, 2 corridas de n=10, p50 / p95):**

| Escenario | Línea base (corrida 1) | Corrida 1 | Corrida 2 |
|---|---|---|---|
| arranque, App actual (`GET /me` ‖ `GET /groups`, luego listado ‖ socket) | — | 787 / 1176 ms | 768 / 803 ms |
| arranque, flujo anterior (6 HTTP + 1 socket) | 54683 / 57999 ms | 1544 / 1925 ms | 1520 / 1794 ms |
| abrir chat | 433 / 452 ms | 427 / 703 ms | 460 / 727 ms |
| enviar | 948 / 1029 ms | 290 / 624 ms | 309 / 409 ms |
| votar | 620 / 673 ms | 266 / 293 ms | 258 / 320 ms |

- **Cómo se midió.** Con el script actualizado: agrega el escenario del arranque actual, conserva el anterior para comparar y envía `initData` también en el socket, porque desde T04 la API rechaza el socket sin él. Se usó una solicitud sembrada en curso, con umbrales de staging de 5 y 5. Los votos son en número par, así que la solicitud quedó como estaba.
- **Lo que se ve.**
  - El arranque bajó de ~55 s a menos de 1 s, sobre todo por el listado liviano (T40): `GET /request-chats` pasó de 24–28 s a ~300 ms.
  - Enviar bajó a un tercio y votar a menos de la mitad.
  - Abrir chat no cambió.
- **Qué incluyen los números.** Se miden desde el cliente, así que incluyen la red hasta Render: cada petición tarda ~200–300 ms aunque el servidor responda rápido. Con n=10, el p95 es el máximo; el 624 ms de enviar en la corrida 1 es un solo valor alto. El p95 < 500 ms de RNF-REN-07 se mide en la API, con las líneas `Timing` de los logs de staging.
**Medición tras el release (2026-10-03, staging, n=20, p50 / p95, medida desde el cliente):**

| Escenario | Desde el cliente | Estimado en la API (restando la red) |
|---|---|---|
| arranque, App actual | 783 / 1175 ms | — |
| arranque, flujo anterior | 1551 / 1724 ms | — |
| abrir chat (solo `GET /request-chats/:id`, como la App actual) | 490 / 663 ms | ~355 / ~500 ms |
| enviar | 297 / 323 ms | ~150 / ~175 ms |
| votar | 275 / 600 ms | ~140 / ~450 ms |
| red (`GET /`, sin Mongo ni Telegram) | 133–148 / 165–174 ms | — |

- **Cómo se estima.** El tiempo en la API se estimó restando la ida y vuelta de la red, medida con `GET /`. El dato exacto de RNF-REN-07 son las líneas `Timing` de los logs de Render.
- **Enviar y votar cumplen** p95 < 500 ms. El p95 de votar sale de dos valores altos (máximo 701 ms); el p50 es ~140 ms.
- **Abrir chat queda justo en el límite.** `GET /request-chats/:id` trae todos los mensajes de la solicitud con sus autores: la de prueba tiene unos 100 con los de las mediciones. Se resuelve con el historial paginado (T18).
- **Escenario "abrir chat" del script.** Todavía conecta un socket nuevo, como la App antes de T42. Hoy la App reutiliza su socket, así que abrir un chat es solo la petición HTTP, y se midió aparte.
- **RNF-REN-08** (ninguna petición espera a Telegram) lo cubren las pruebas de T41, con Telegram simulado de 2 s. Los tiempos de enviar y votar, ~150 ms en la API, son coherentes con eso.

- **Incidente.** Una corrida anterior, con umbrales de 3 y 1 en staging, cerró como rechazada una solicitud sembrada (Wendy Ruiz) y anunció el rechazo en el grupo de staging. El seed se había generado con los umbrales por defecto (5 y 3), así que había solicitudes "en curso" que ya alcanzaban el umbral. Si se vuelve a sembrar, hay que pasar `APPROVE_THRESHOLD` y `REJECT_THRESHOLD` iguales a los de la API.

**Cómo medirla:** con el servidor de staging desplegado, correr dos veces
`PERF_BASE_URL=<url-staging> PERF_TELEGRAM_ID=<id-de-prueba> PERF_CHAT_ID=<uuid-chat-de-prueba> PERF_WRITES=1 npm run perf:baseline`
y pegar aquí la línea final que imprime (p50 / p95). Sin `PERF_WRITES=1` solo mide arranque y abrir chat; enviar y votar escriben en la BD y notifican por Telegram, así que van contra un chat de prueba en curso al que le falten al menos 2 votos para el umbral. Las variables y precauciones están al inicio de `scripts/perf/latency-baseline.ts`. Contra el código anterior a T40, `GET /request-chats` tarda ~28 s: usar `PERF_TIMEOUT_MS=60000 PERF_ITERATIONS=3`. Un socket que no conecta no detiene la corrida; se reporta como fallo junto al escenario. El desglose Mongo / Telegram de cada petición sale en las líneas `Timing` de los logs del servidor, p. ej. `HTTP GET /request-chats/:id 200 132ms (mongo 95ms/3 · telegram 0ms/0)`.

---

## Task 38: Índices y lecturas livianas

**Repo:** API · **RNF:** REN-07

**Description:** Hoy ningún schema declara índices, y `users.telegramId` se busca en cada petición. Agregar índices en `users.telegramId` (único), `groups.telegramId` y `requestchats.requester`. Usar `lean()` y proyecciones en lecturas que no necesitan documentos de Mongoose. Eliminar la doble búsqueda del usuario en `GET /users/:telegramId` (middleware + controller).

**Acceptance criteria:**
- [x] `explain()` de las tres búsquedas usa índice (`IXSCAN`), no `COLLSCAN`
- [x] `GET /users/:telegramId` hace una sola consulta a `users` (si pide al propio usuario, reutiliza el de `TmaAuthGuard`)
- [x] Los índices se crean sin error sobre los datos existentes (sin `telegramId` duplicados)

**Verification:**
- [x] `explain()` en staging. El 2026-10-02 se corrió `node --env-file=.env scripts/check-indexes-t38.mjs` sobre `furmeets_development`, la base de staging. Resultado: sin duplicados; índices `users.telegramId_1` (único), `groups.telegramId_1` y `requestchats.requester_1`; las tres búsquedas con `EXPRESS_IXSCAN`.
- [ ] Logs de T37 antes y después (pendiente con la línea base de T37)

**Dependencies:** None (requiere aprobación: cambia índices en producción)

**Files likely touched:**
- `src/members/infraestructure/schemas/user.schema.ts`, `group.schema.ts`
- `src/chat/infraestructure/schemas/request-chat.schema.ts`
- `src/members/infraestructure/repositories/user-mongo.repository.ts`
- `src/members/presentation/users.controller.ts`

**Estimated scope:** S

---

## Task 02: Infraestructura de pruebas y validación

**Repo:** API · **RNF:** CAL-01, CAL-02, SEG-05

**Description:** Crear `test/jest-e2e.json`, un helper para levantar la app Nest con BD de prueba y un generador de `initData` firmado para pruebas. Registrar el `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`) con `class-validator` + `class-transformer`, el mismo en la app y en las e2e. Primera prueba unitaria de ejemplo sobre una entidad existente.

**Acceptance criteria:**
- [x] `npm test` y `npm run test:e2e` corren; la BD de e2e corre en memoria con `mongodb-memory-server`, aislada de la de desarrollo (`test/helpers/app.ts`; lo comprueba `app.e2e-spec.ts`)
- [x] Existe un helper `signInitData(user, botToken)` reutilizable (`test/helpers/init-data.ts`, con sus propias unitarias)
- [x] Un body con campos no declarados en el DTO o con tipos inválidos → 400 (`ValidationPipe` global en `src/shared/validation/validation.ts`)

**Verification:**
- [x] `npm run test:e2e` pasa con una prueba de humo (`GET /` → 200) y una de validación (`vote/:type` inválido → 400). Verificado el 2026-10-02 en el Checkpoint A.

**Dependencies:** None

**Files likely touched:**
- `package.json` (`mongodb-memory-server` en devDependencies; `class-validator` y `class-transformer` en dependencies)
- `src/main.ts` (`ValidationPipe` global)
- `test/jest-e2e.json`
- `test/helpers/app.ts`, `test/helpers/init-data.ts`
- `test/app.e2e-spec.ts`

**Estimated scope:** S

---

## Task 03: Autenticación HTTP por `initData`

**Repo:** API · **RNF:** SEG-01, SEG-02, OBS-02 · **Deuda:** #2, #17

**Description:** Crear el módulo `auth` con un validador puro de `initData` (HMAC-SHA256 con clave `HMAC_SHA256("WebAppData", BOT_TOKEN)`, `auth_date` < 24 h) y un guard global que lea `Authorization: tma <initDataRaw>` y deje el usuario en el request. Reemplaza `user.middleware.ts` y `x-telegram-id`. El usuario se crea o actualiza (upsert) a partir de `initData`, eliminando el flujo muerto `POST /users`.

**Acceptance criteria:**
- [x] Sin header, con firma inválida o con `auth_date` vencido → 401
- [x] Con `initData` válido, `request.user` contiene el usuario y existe en BD
- [x] `x-telegram-id` ya no se lee en ningún lugar

**Verification:**
- [x] Unitarias del validador (firma válida, alterada, vencida, sin hash)
- [x] e2e: endpoint protegido con y sin header

**Dependencies:** T02

**Files likely touched:**
- `src/auth/domain/init-data.validator.ts` (+ `.spec.ts`)
- `src/auth/presentation/tma-auth.guard.ts`
- `src/auth/auth.module.ts`
- `src/shared/middlewares/user.middleware.ts` (eliminar)
- `src/members/presentation/users.controller.ts`

**Estimated scope:** M

---

## Task 04: Autenticación del socket por `initData`

**Repo:** API · **RNF:** SEG-01, SEG-02 · **Deuda:** #3

**Description:** Validar `handshake.auth.initData` al conectar al gateway, con el mismo validador de T03. El autor de cualquier evento es el usuario del socket, nunca un campo del payload.

**Acceptance criteria:**
- [x] Conexión sin `initData` válido → desconectada con error
- [x] Los handlers ignoran `userUUID` del payload y usan `socket.data.user`

**Verification:**
- [x] e2e con `socket.io-client`: conexión inválida rechazada; mensaje con `userUUID` ajeno queda a nombre del usuario autenticado

**Dependencies:** T03

**Files likely touched:**
- `src/chat/presentation/chat.gateway.ts`
- `src/auth/presentation/ws-auth.middleware.ts`

**Estimated scope:** S

---

## Task 39: Telegram fuera del camino crítico al arrancar

**Repo:** API · **RNF:** REN-02, REN-03, REN-08

**Description:** Hoy abrir la App espera `POST /groups/sync`, que hace ~9 llamadas a Telegram en serie (`getMe`, `getChat`, `getChatMember`, `getUserProfilePhotos`, `getFile`…) y ~6 a Mongo. Cambios:
- Usar `bot.botInfo` (grammY ya lo tiene tras `init`) en vez de `getMe` en cada llamada.
- Cachear en memoria la info del grupo y del bot (TTL 10 min, como la membresía).
- Sincronizar la foto del usuario y del grupo en segundo plano, en paralelo y como máximo una vez por TTL. Ninguna petición del usuario la espera.
- Elegir el tamaño de foto más pequeño adecuado para avatares (no el de 640 px) y tolerar fotos con menos tamaños.

**Acceptance criteria:**
- [x] Ninguna ruta usada al arrancar espera una llamada a Telegram con la caché caliente
- [x] `getMe` no se llama después del arranque del bot
- [x] Si Telegram tarda o falla, la App carga igual con los datos guardados

**Verification:**
- [x] Unitarias con un cliente de Telegram simulado que tarda 2 s: la respuesta no espera
- [ ] Logs de T37: duración del arranque antes y después

**Dependencies:** T03

**Files likely touched:**
- `src/telegram-bot/telegram-bot.service.ts`
- `src/members/application/groups.service.ts`, `user.service.ts`
- `src/members/infraestructure/repositories/group-adapter.repository.ts`, `user-mongo.repository.ts`

**Estimated scope:** M

---

## Task 05: Rol en vivo (`membership`) y `GET /me`

**Repo:** API · **RNF:** REN-02, REN-03, REN-08, SEG-10 · **Deuda:** #9

**Description:** Resolver el rol con `getChatMember` (miembro si `creator`, `administrator`, `member` o `restricted` con `is_member=true`) con caché en memoria de TTL 10 min, **invalidada además por eventos**: el bot recibe los updates `chat_member` del grupo (hay que incluirlos en `allowed_updates`, Telegram no los envía por defecto) y, cuando alguien entra, sale, es expulsado o restringido, borra la entrada de ese usuario. La caché expone `invalidate(userId)` para otros módulos (T25). Exponer `GET /me` → `{ user, role, requestChatId?, requestChatState? }`, que reemplaza a `POST /groups/sync` como única petición de arranque. La sincronización de avatar y grupo es la de T39 (en segundo plano).

**Acceptance criteria:**
- [x] `GET /me` devuelve `role: 'member' | 'applicant'` según Telegram, no según `group.members`; para un solicitante con solicitud incluye `requestChatId`
- [x] Dos llamadas dentro de 10 min hacen una sola consulta a Telegram; pasados 10 min se vuelve a consultar. Con la caché caliente, `GET /me` no llama a Telegram
- [x] Un update `chat_member` de un usuario invalida su entrada: la siguiente petición ya refleja el rol nuevo

**Verification:**
- [x] Unitarias: mapeo de cada `status` a rol; caché, expiración e invalidación
- [x] e2e con el cliente de Telegram simulado: miembro expulsado → solicitante en la siguiente petición (`GET /me`). El 403 del voto depende de la autorización por rol y se verifica en la matriz de T06.

**Dependencies:** T03, T39

**Files likely touched:**
- `src/membership/application/membership.service.ts` (+ `.spec.ts`)
- `src/membership/infraestructure/telegram-membership.adapter.ts`
- `src/membership/presentation/me.controller.ts`
- `src/membership/presentation/chat-member.handler.ts`
- `src/telegram-bot/telegram-bot.server.ts` (`allowed_updates` con `chat_member`)
- `src/members/application/groups.service.ts`

**Estimated scope:** M

---

## Task 06: Autorización por rol y salas por solicitud

**Repo:** API · **RNF:** SEG-04, PRI-03, OBS-02 · **Deuda:** #3, #4

**Description:** Decoradores/guards `@MembersOnly()` y `@OwnerOrMember()` para HTTP y socket. El gateway une a cada socket solo a `request-chat:<id>` autorizado y, si es miembro, a `members`. Se elimina `server.emit` global.

**Acceptance criteria:**
- [x] Solicitante pidiendo la solicitud de otro → 403; solicitante votando → 403 (incluye al miembro recién expulsado, RNF-SEG-10)
- [x] Un solicitante conectado no recibe eventos de otras solicitudes
- [x] No queda ningún `server.emit` sin `.to(...)`

**Verification:**
- [x] e2e: matriz rol × endpoint/evento (criterios de éxito 2 y 4)

**Dependencies:** T04, T05

**Files likely touched:**
- `src/auth/presentation/roles.guard.ts`, `roles.decorator.ts`
- `src/chat/presentation/request-chat.controller.ts`
- `src/chat/presentation/chat.gateway.ts`
- `test/authorization.e2e-spec.ts`

**Estimated scope:** M

### Checkpoint A: después de T01–T06 (con T37–T39)
- [x] Criterios de éxito 1, 2 y 4 cubiertos por e2e (las 43 pruebas pasan el 2026-10-02):
  - **1. Sin `initData` válido → 401 o rechazo:** `test/auth.e2e-spec.ts` (HTTP: sin header, otro esquema, firma inválida, usuario alterado, `auth_date` vencido, solo `x-telegram-id`) y `test/chat-socket.e2e-spec.ts` (socket: sin `initData`, firma inválida, vencido, `initData` que no es texto).
  - **2. Solicitante que pide la solicitud de otro → 403; solicitante que vota → 403:** `test/authorization.e2e-spec.ts`, incluido el miembro recién expulsado (RNF-SEG-10).
  - **4. Un solicitante no recibe eventos de otras solicitudes:** `test/authorization.e2e-spec.ts`, en la sección `socket`.
- [x] Revisión humana antes de seguir: los PRs se revisaron y mergearon. Lo manual quedó así:
  - **T01:** token revocado y rotado en staging y en producción (2026-10-03).
  - **T37:** línea base anotada (2026-10-03) y medida de nuevo tras T38–T42.
  - **T38 y T39:** el script de T37 se corrió antes y después; los índices se verificaron en staging y en producción (`EXPRESS_IXSCAN`). Faltan las líneas `Timing` de los logs.

---

## Task 07: App autenticada y enrutada por rol

**Repo:** App · **RNF:** SEG-01, USA-02, REN-02, REN-03 · **Deuda:** #9, #12, #17

**Description:** RTK Query envía `Authorization: tma <initDataRaw>` y socket.io lo envía en `auth`. El arranque llama solo a `GET /me` y enruta según el flujo principal (SPEC §1); lo demás que necesite la pantalla se pide en paralelo, nunca encadenado. Se eliminan la espera de `POST /groups/sync` (`App.tsx:37-40`), los `refetch()` duplicados de `IndexPage.tsx`, `RequireBeMember` basado en BD, el hack `isRequester` con `123456789` y `telegramUserId || 1`.

**Acceptance criteria:**
- [ ] Ninguna petición envía `x-telegram-id` y nada espera a `POST /groups/sync`
- [ ] Miembro → Inicio; solicitante sin solicitud → Formulario; con solicitud → su chat / Aprobado / No aprobado
- [ ] El arranque hace a lo sumo 2 peticiones y ninguna depende de otra (salvo `GET /me`); sin ids fijos de prueba

**Verification:**
- [ ] Manual en staging con una cuenta miembro y otra no miembro; pestaña Network de DevTools para contar peticiones

**Dependencies:** T05, T06

**Files likely touched:**
- `src/services/*.service.ts` (baseQuery)
- `src/components/RequireBeMember.tsx`
- `src/navigation/routes.tsx`, `private-routes.tsx`
- `src/components/App.tsx`
- `src/pages/IndexPage/IndexPage.tsx`
- `src/state/user.slice.ts`

**Estimated scope:** M

---

## Task 43: App: bundle más liviano

**Repo:** App · **RNF:** REN-02 · **Deuda:** #14

**Description:** El JS inicial es un solo archivo de ~1 MB. Quitar `@tonconnect/ui-react` y `TonConnectUIProvider` (sin uso) y cargar cada página con `React.lazy` + `Suspense`.

**Acceptance criteria:**
- [ ] `@tonconnect/ui-react` no está en `package.json`
- [ ] Cada ruta es un chunk separado
- [ ] El tamaño del JS inicial (gzip) se anota antes y después, y baja

**Verification:**
- [ ] `npm run build` y comparación del tamaño de `dist/assets`

**Dependencies:** None

**Files likely touched:**
- `src/components/Root.tsx`
- `src/navigation/routes.tsx`
- `package.json`

**Estimated scope:** S

---

## Task 08: Módulo `media`: canal de almacenamiento y proxy `/media/:id`

**Repo:** API · **RNF:** SEG-03, OPE-01 · **Deuda:** #10

**Description:** Subir imágenes con `sendPhoto` al canal `TELEGRAM_STORAGE_CHAT_ID` y guardar `file_id`/`file_unique_id`. `GET /media/:id` resuelve `getFile` (con caché TTL corto) y transmite los bytes con `Cache-Control: private, max-age=86400`, autorizado por rol. Avatares y foto del grupo pasan a guardarse como `file_id`.

**Acceptance criteria:**
- [x] `GET /media/:id` sin auth → 401; con auth de un usuario no autorizado para esa imagen → 403
- [x] Ninguna respuesta de la API contiene `api.telegram.org/file/bot`
- [x] Los usuarios guardan `avatarFileId` en lugar de `file_path`. Se guarda `avatarMediaId`, el id del registro en la colección `media`, que contiene el `file_id`. Así la App pide `/media/:id` sin consultas extra. El grupo guarda `photoMediaId`.

**Verification:**
- [x] Unitarias del servicio con el cliente de Telegram simulado
- [x] e2e: subida y descarga

**Notas de implementación:**
- `POST /media` (multipart, campo `file`) sube una imagen y devuelve `{ id }`. Valida el tipo por los primeros bytes (JPEG/PNG/WebP → si no, 400) y el tamaño (> 10 MB → 413). T14 y T17 la reutilizan.
- Quién ve cada imagen: un miembro ve todas. Cualquier usuario autenticado ve avatares y la foto del grupo. Una imagen subida solo la ve quien la subió; T14 y T17 la abren a los participantes de su solicitud.
- `TELEGRAM_STORAGE_CHAT_ID` es opcional. Sin ella, avatares y foto del grupo funcionan, pero `POST /media` responde 503.
- Los registros viejos con `avatarUrl` y `photoUrl` se ignoran. El avatar y la foto se vuelven a guardar como id de `media` en la siguiente sincronización. Borrar esos campos le toca a T12.

**Dependencies:** T06

**Files likely touched:**
- `src/media/application/media.service.ts` (+ `.spec.ts`)
- `src/media/infraestructure/telegram-storage.adapter.ts`
- `src/media/presentation/media.controller.ts`
- `src/members/infraestructure/repositories/user-mongo.repository.ts`
- `src/telegram-bot/telegram-bot.config.ts`

**Estimated scope:** M

---

## Task 09: App sin token del bot

**Repo:** App · **RNF:** SEG-03 · **Deuda:** #1, #14

**Description:** Quitar `VITE_TELEGRAM_BOT_TOKEN` y toda URL `api.telegram.org/file/bot…`. Avatares, foto del grupo e imágenes se piden a `/media/:id` con auth (fetch → blob URL). Sustituir el avatar por defecto de GitHub.

**Acceptance criteria:**
- [x] `grep -r "api.telegram.org" dist/` y `grep -r "VITE_TELEGRAM_BOT_TOKEN"` vacíos (build de `main`, 2026-10-03)
- [ ] Avatares e imágenes se ven igual que antes

**Verification:**
- [x] `npm run build` + grep sobre `dist/` (criterio de éxito 3)

**Dependencies:** T01, T08

**Files likely touched:**
- `src/state/hub.slice.ts`, `src/state/request-chat.slice.ts`
- `src/components/ChatBubble/ChatBubble.tsx`
- `src/components/AuthImage.tsx` (nuevo)
- `.env.example`

**Estimated scope:** M

---

## Task 10: Mensajes en su propia colección

**Repo:** API · **RNF:** CON-01, CAL-04 · **Deuda:** #5, #16

**Description:** Nueva colección `requestchatmessages` (con `requestChatId`, `authorId`, `createdAt` persistido, índices por `requestChatId + createdAt`). Enviar un mensaje es un `insertOne`. Las fechas salen en ISO-8601 UTC.

**Acceptance criteria:**
- [x] 20 mensajes concurrentes en el mismo chat → 20 persistidos, en orden, con su `createdAt`
- [x] El documento de la solicitud ya no embebe mensajes
- [x] Las respuestas devuelven fechas ISO UTC, sin formateo de zona en el servidor

**Verification:**
- [x] e2e de concurrencia (criterio de éxito 5)

**Notas de implementación:**
- **Forma del documento.** `{ _id, requestChatId, authorId, content, createdAt }`, con índice `{ requestChatId: 1, createdAt: 1 }`. T12 migra directo a esta forma. (T40 quitó los leídos por mensaje.)
- **`createdAt`.** Lo pone un reloj monótono del servidor (`MonotonicClock`): dos mensajes nunca comparten fecha, y ordenar por `createdAt` da el orden de llegada. Vale para una sola instancia de la API.
- **Mensajes del bot.** Bienvenida, aprobado y rechazado los crea `RequestChatEntity` y se insertan aparte.
- **Votos y leídos.** Al votar, la solicitud todavía se guarda completa (lo cambia T11), pero ya sin mensajes. El `GET` sigue marcando leídos, ahora con un solo `updateMany` (T11 lo pasa a una operación explícita).
- **Listado.** Carga los mensajes de todas las solicitudes en una consulta (T40 lo cambia por una agregación). `lastMessage` es opcional.
- **Datos existentes.** Las solicitudes creadas antes de T10 no muestran mensajes hasta que corra la migración de T12. **No desplegar T10 a producción sin T12.**
- **Seed y medición.** El seed de staging escribe en la colección nueva; hay que volver a sembrar con `--reset`. `perf:hydration` mide las consultas nuevas: 418 documentos hidratados con el volumen por defecto.

**Dependencies:** T02

**Files likely touched:**
- `src/chat/infraestructure/schemas/request-chat-message.schema.ts`
- `src/chat/infraestructure/repositories/chat-mongo.repository.ts`
- `src/chat/mappers/request-chat-message.mapper.ts`
- `src/chat/domain/value-objects/chat-date.value-object.ts`

**Estimated scope:** M

---

## Task 11: Operaciones atómicas y lecturas sin efectos

**Repo:** API · **RNF:** CON-01, CON-05 · **Deuda:** #5, #6

**Description:** Votos y leídos se actualizan con `$set`/`$push`/`$pull` filtrados; nada llama `updateOne` con el agregado completo. `GET` de una solicitud deja de marcar leídos; el marcado pasa a una operación explícita.

**Acceptance criteria:**
- [x] Ningún método del repositorio reescribe el documento completo
- [x] Un `GET` no modifica la BD
- [x] Votos concurrentes de miembros distintos quedan todos guardados

**Verification:**
- [x] Unitarias del servicio; e2e de votos concurrentes

**Notas de implementación:**
- **Votos.** `RequestChatEntity.addVote` decide qué cambia y no toca el estado: si el miembro repite su voto, se retira; si es nuevo o distinto, se fija. `ChatRepository.applyVote` lo guarda con una operación filtrada por `state: InProgress`. Para retirar usa `$pull`. Para fijar usa `$set` sobre `votes.$`, o `$push` con `votes.from: { $ne }`. Devuelve la solicitud con los votos de todos.
- **Cierre.** `outcome()` evalúa los umbrales con esos votos. `ChatRepository.close` es condicional (`InProgress` → `Approved`/`Rejected`). Si varios votos cruzan el umbral a la vez, solo uno cierra la solicitud, así que el mensaje de cierre y los avisos salen una vez. Los votos que llegan después del cierre reciben 409.
- **Leídos.** `GET /request-chats/:id` ya no escribe. El marcado de leídos es `POST /request-chats/:id/read`: responde 204, lo pueden usar el dueño o un miembro, y hace un solo `updateMany`. La App lo llama al abrir el chat (PR de la App de T11). T40 quitó este endpoint junto con los leídos.
- **Las pruebas detectan el problema.** Con el código anterior fallan 3 de las 4 e2e nuevas: votos perdidos, cierre repetido y un `GET` que escribe.

**Dependencies:** T10

**Files likely touched:**
- `src/chat/infraestructure/repositories/chat-mongo.repository.ts`
- `src/chat/domain/services/chat.repository.ts`
- `src/chat/application/chat.service.ts`

**Estimated scope:** M

---

## Task 12: Migración de datos existentes

**Repo:** API · **RNF:** CON-06, PRI-05

**Description:** Script versionado e idempotente según SPEC §9.1: mueve mensajes embebidos a la colección nueva conservando solo `_id`, autor, contenido y `createdAt`, `whereYouFoundUs` → "¿Cómo conociste FurMeets?", `interests` → `legacy.interests`, marca `legacy: true`, `species` a texto libre, descarta `avatarUrl`. Renombra la colección original sin borrarla.

**Acceptance criteria:**
- [x] Correrlo dos veces no duplica nada
- [x] Mismo conteo de mensajes y votos antes y después: el script lo verifica al final y termina con código 1 si no cuadra
- [x] Ensayado en staging (2026-10-03), con los datos sembrados de staging y no con una copia de producción: producción tiene los `telegramId` reales de los miembros y no se copia (decisión del 2026-10-03)
- [x] Ejecución en producción solo con respaldo y aprobación humana: 2026-10-03, tras el respaldo y el despliegue del release. 83 solicitudes; 1647 mensajes migrados; 431 votos; 121 `avatarUrl` quitados. Verificación OK y copia `requestchats_pre_001` conservada.

**Verification:**
- [x] Unitarias de las transformaciones y de la idempotencia (`scripts/migrations/001-request-chat-split.spec.ts`, contra un Mongo en memoria). Cubren solo lectura, migración completa, segunda corrida, corte a mitad de camino y mensaje sin autor.
- [x] e2e del criterio de éxito 14 (`test/migration-001.e2e-spec.ts`). Una solicitud con el formato de `main` se abre sin mensajes antes de migrar; después aparece con sus mensajes en orden, sus votos, su bloque `legacy` y su último mensaje en el listado.
- [x] Reporte de conteos del ensayo en staging (criterio de éxito 14), abajo

**Notas de implementación:**
- **Uso.** `DB_URI=... npm run migrate:001` solo informa. Para migrar: `DB_URI=... CONFIRM=<base> npm run migrate:001 -- --apply`. Correrla con la API detenida o sin tráfico: un voto durante la migración descuadra el conteo de votos (no se pierde).
- **Pasos** (correrla de nuevo no duplica nada):
  1. Copia `requestchats` en `requestchats_pre_001`, solo la primera vez.
  2. Pasa los mensajes embebidos a `requestchatmessages` con su mismo `_id`. Inserta sin pisar y después quita `messages`. Se descartan `viewedBy` y `updatedAt`.
  3. Marca `legacy` toda solicitud sin `form`.
  4. Quita `users.avatarUrl`.
  5. Verifica que los mensajes de la copia estén en la colección nueva y que los votos coincidan.
- **Diferencias con SPEC §9.1** (la SPEC ya está actualizada):
  - **Copia en lugar de renombrar:** renombrar se lleva los índices de la colección viva, entre ellos el único de `requester`.
  - **`whereYouFoundUs` va a `legacy.howDidYouFindUs`,** que es la pregunta "¿Cómo conociste FurMeets?". No va a `form`, porque `form` exige edad y ciudad.
  - **`legacy: true` es el bloque `legacy`:** su presencia marca la solicitud.
- **Modelo.**
  - La solicitud ya no tiene `whereYouFoundUs` ni `interests` sueltos: tiene `legacy` (`LegacyApplication`). `GET /request-chats/:id` devuelve `legacy` en lugar de esos dos campos; la App actual no los mostraba.
  - `POST /request-chats` (formulario anterior) creaba solicitudes `legacy` hasta que T15 lo eliminó.
  - `species` del usuario es texto libre: con el enum, una especie fuera de la lista hacía fallar la lectura del usuario.
  - El seed escribe `legacy`.
- **Ensayo en staging (2026-10-03).** Sus 41 solicitudes eran del seed anterior a T10, con los mensajes embebidos, igual que producción.

  | | Antes | Después |
  |---|---|---|
  | Solicitudes | 41 | 41 |
  | Con mensajes embebidos | 41 | 0 |
  | Mensajes embebidos | 2683 | 0 |
  | Sin `form` ni `legacy` | 41 | 0 |
  | Votos | 179 | 179 |
  | Usuarios con `avatarUrl` | 5 | 0 |

  - Se insertaron 2683 mensajes y se marcaron 41 solicitudes `legacy`. La verificación dio mensajes 2683/2683 y votos 179/179: OK.
  - Una segunda corrida no hizo nada y la verificación siguió en OK.
  - El índice único de `requester` se conservó.
  - Desde la API de staging: las 41 solicitudes se abren con sus mensajes (2727 en total: los 2683 migrados más 44 que ya estaban en la colección nueva) y las 41 tienen último mensaje en el listado.
- **Producción, en el release.**
  1. Respaldo con el export de Atlas.
  2. `migrate:001` en modo lectura.
  3. Desplegar API y App.
  4. `--apply` enseguida, con poco tráfico.
  5. Revisar la verificación final.
  6. Borrar `requestchats_pre_001` cuando todo se vea bien.

**Dependencies:** T10, T11, T13

> **Orden:** se hace después de T13 (decidido el 2026-10-02). Así migra los campos del formulario (`whereYouFoundUs`, `interests`, especie) directo al modelo que define T13, en una sola migración. Mientras tanto, las solicitudes anteriores a T10 no muestran sus mensajes: **no desplegar a producción entre T10 y T12.**

**Files likely touched:**
- `scripts/migrations/001-request-chat-split.ts` (+ `.spec.ts`)
- `package.json` (script `migrate:001` y `scripts` en las raíces de Jest)
- `src/applications/domain/legacy-application.ts`, `src/chat/domain/entities/request-chat.entity.ts`, `src/members/domain/entities/user.entity.ts`
- `test/migration-001.e2e-spec.ts`

**Estimated scope:** M

---

## Task 40: Listado liviano de solicitudes

**Repo:** API · **RNF:** REN-04, REN-07

**Description:** Hoy `GET /request-chats` carga todas las solicitudes con todos sus mensajes y 4 `populate`, aunque la lista solo usa un resumen. Devolver el resumen con una agregación (último mensaje, conteo de votos a favor y en contra), paginado y sin cargar mensajes completos.

**Acceptance criteria:**
- [x] La respuesta no contiene arreglos de mensajes ni de leídos
- [x] El tiempo de respuesta no crece con la cantidad total de mensajes (medido con datos de prueba de 50 solicitudes × 200 mensajes)
- [x] Solo expone conteos de votos en contra, nunca identidades (regla vigente hasta el 2026-10-03; los nombres se agregan en T21)

**Verification:**
- [x] e2e sobre la forma de la respuesta (`test/request-chat-list.e2e-spec.ts`)
- [x] Medición con `npm run perf:list` (Mongo en memoria). El script de T37 mide contra staging y queda para cuando se tome la línea base.

**Notas de implementación:**
- **Una agregación.** Ordena por `createdAt` y `_id` descendentes (índice nuevo `{ createdAt: -1, _id: -1 }`). Trae el solicitante y el último mensaje con su autor con `$lookup`, y cuenta votos con `$filter`. No hay `populate` ni documentos de Mongoose.
- **Respuesta.** Cada solicitud trae `uuid`, `requester`, `lastMessage?`, `state`, `votes: { approved, rejected }`, `userVote?` (solo el de quien pide) y `createdAt`. La lista trae `nextCursor` si hay otra página.
- **Paginación.** `GET /request-chats?limit=&cursor=`. `limit` va de 1 a 100 y por defecto es 50, holgado mientras la App pide solo la primera página (pagina en T23). `cursor` es opaco (base64url de fecha + id), y uno ajeno da 400.
- **Sin leídos (decidido el 2026-10-02 y el 2026-10-03).** No interesa saber quién vio cada mensaje ni llevar un contador de no leídos. Se quitaron los leídos de cada mensaje, `unreadMessagesCount` del listado y `POST /request-chats/:id/read`.
- **Medición** (`npm run perf:list`, 50 solicitudes, p50; antes son las consultas de T10):

  | Mensajes por solicitud | Total | Antes | Ahora |
  |---|---|---|---|
  | 10 | 500 | 32 ms | 17 ms |
  | 50 | 2.500 | 74 ms | 17 ms |
  | 200 | 10.000 | 240 ms | 17 ms |
  | 400 | 20.000 | 467 ms | 17 ms |
- **Seed.** Ya no siembra leídos: hay que volver a sembrar staging con `--reset` para limpiar los que dejó T10.
- **Reemplaza a `perf:hydration`**, que medía las consultas de T10.

**Dependencies:** T10

**Files likely touched:**
- `src/chat/infraestructure/repositories/chat-mongo.repository.ts`
- `src/chat/application/chat.service.ts`
- `src/chat/presentation/dtos/list-request-chat.dto.ts`
- `src/chat/mappers/request-chat.mapper.ts`

**Estimated scope:** M

---

## Task 41: Enviar y votar sin esperar a Telegram

**Repo:** API · **RNF:** REN-06, REN-07, REN-08, CON-04 · **Deuda:** #7

**Description:** Hoy enviar un mensaje espera ~5 operaciones de Mongo y un `sendMessage` de Telegram antes de emitir, y votar espera ~5 llamadas a Telegram en serie. Nuevo orden: persistir (una operación atómica) → ack al emisor y emit a la sala → notificaciones de Telegram en segundo plano, con log de error. El emit ocurre después de guardar. Crear un helper de cola reutilizable (en memoria, con reintento simple), que después usan T16, T27 y T29.

**Acceptance criteria:**
- [x] El ack y el emit no esperan ninguna llamada a Telegram (verificado con Telegram simulado que tarda 2 s)
- [x] Si Telegram falla, el mensaje o voto queda guardado y emitido, y el error se registra
- [x] Enviar y votar hacen como máximo 2 operaciones de Mongo en el camino crítico

**Verification:**
- [x] Unitarias del servicio con Telegram simulado lento y con error (`chat.service.spec.ts`, `background-queue.spec.ts`)
- [x] e2e con Telegram simulado de 2 s y con error, contando los comandos de Mongo (`test/send-vote-background.e2e-spec.ts`)
- [ ] Script de T37: p95 de enviar y votar < 500 ms en staging. Queda para cuando se tome la línea base, como en T40.

**Notas de implementación:**
- **Cola.** `BackgroundQueue` (`src/shared/async/background-queue.ts`): en memoria, de a una tarea y en orden de llegada, hasta 3 intentos con espera creciente, máximo 1.000 pendientes, y al apagar espera hasta 5 s. Corre fuera del contexto de medición de la petición, así sus llamadas no suman al log de tiempos. Lo encolado se pierde si el proceso se reinicia: sirve para avisos, no para datos. Queda en `shared` y no en `telegram-bridge` porque ese módulo aún no existe y la cola no depende de Telegram; T16, T27 y T29 la reutilizan.
- **Enviar** (socket `request-chat`). Una lectura liviana de solicitante y estado (`findHeader`, sin `populate`) que sirve para autorizar y validar, y la inserción: 2 operaciones. El gateway emite a la sala y devuelve el mensaje como ack. El aviso de Telegram va a la cola; si escribe un miembro, el solicitante se lee ahí, fuera del camino crítico. La autorización pasó del gateway al servicio (`canAccessLoaded`) para no leer la solicitud dos veces.
- **Votar.** Alternar el voto (repetir lo retira, otro lo reemplaza) es ahora un único `findOneAndUpdate` con pipeline de actualización: decide y escribe en la misma operación atómica, sin leer antes. Si cruza un umbral, un `updateOne` filtrado cierra la solicitud: 2 operaciones. Solo si otro voto la cerró entre medio se lee su estado real (una tercera, poco común). La regla de alternar salió de la entidad (`addVote`) y quedó en el repositorio; el umbral sigue en el dominio (`RequestChatEntity.outcomeFor`).
- **Cierre en segundo plano.** El mensaje de cierre, el `request-chat-update` y los avisos de Telegram van a la cola. El mensaje de cierre no se reintenta, para no duplicarlo si la inserción llegó a guardarse.
- **Cambio de contrato.** `PUT /request-chats/:id/vote/:type` responde solo `{ uuid, state, votes, userVote? }`, sin mensajes ni solicitante: devolver la solicitud completa costaba 3 lecturas más. Si el voto cerró la solicitud, la solicitud con el mensaje de cierre llega por `request-chat-update`. La App se ajustó en la rama `feat/t41-light-vote-response`; **API y App se despliegan juntas.**
- **Qué cuenta como camino crítico.** Las 2 operaciones son las de enviar y votar. Una petición HTTP suma además la lectura del usuario autenticado (`find`), común a todos los endpoints; el socket la hace al conectar, no por mensaje.
- **Crear solicitud** también dejó de esperar el anuncio al grupo (RNF-REN-08).
- **Aviso al grupo de un mensaje del solicitante** (decidido el 2026-10-03). Lleva el nombre, el contenido (escapado para Markdown y recortado a 3.500 caracteres) y un enlace `TELEGRAM_BOT_LINK?startapp=<id de la solicitud>`. La App todavía no lee `startapp`: por ahora el enlace abre la App en el inicio. Que abra la solicitud queda para la App, junto al puente de T27.
- **Hallazgo aparte:** `ValueObject.equals` devuelve `true` para cualquier par de objetos (no compara `props`). Aquí se compara por `.value`; se corrige en T45.

**Dependencies:** T11

**Files likely touched:**
- `src/chat/application/chat.service.ts`
- `src/chat/presentation/chat.gateway.ts`
- `src/shared/async/background-queue.ts` (+ `.spec.ts`)

**Estimated scope:** M

---

## Task 42: App en vivo sin recargas y con UI optimista

**Repo:** App · **RNF:** REN-01, REN-06

**Description:** Hoy cada página abre su propio socket y cada evento provoca un `refetch()` completo de la lista. Cambios:
- Un solo socket compartido por toda la App (se conecta una vez).
- Los eventos parchean la caché de RTK Query con `updateQueryData` en vez de recargar, y se filtran por `requestChatId` (hoy un mensaje de otra solicitud se agrega al chat abierto).
- Envío de mensajes optimista: aparece al instante como "enviando", se confirma con el ack por `clientMessageId` y, si falla, queda como "no enviado" con reintento.
- Voto optimista: el panel refleja el voto al instante y se revierte si la API lo rechaza.

**Acceptance criteria:**
- [x] Recibir un mensaje o voto no genera ninguna petición HTTP
- [x] Navegar entre inicio y chat no abre conexiones de socket nuevas
- [ ] El mensaje y el voto propios se ven antes de la respuesta del servidor (probado con red lenta simulada). Comprobado sobre el store; falta la prueba manual con red lenta.

**Verification:**
- [x] Comprobación del store de la App con socket y `fetch` simulados: parches por evento, filtro por solicitud, cero peticiones al recibir eventos, un solo socket, mensaje optimista con ack, fallo y reintento, voto optimista con reversión y resincronización al reconectar. La App no tiene runner de pruebas: se corrió como script aparte, sin agregarlo al repo.
- [x] e2e de los eventos en la API (`test/live-events.e2e-spec.ts`)
- [ ] Manual en staging con DevTools (Network y throttling "Slow 3G") y dos cuentas

**Notas de implementación:**
- **API.**
  - Cada mensaje trae `requestChatUUID`, para filtrar por solicitud.
  - El envío acepta `clientMessageId` (UUID, opcional), que vuelve en el ack y en el evento. Todavía no se guarda: la idempotencia es T16.
  - Nuevo evento `request-chat-votes`, solo para la sala `members` y tras cada voto: `{ uuid, state, votes }`, sin el voto de nadie (RNF-PRI-01).
  - `request-chat-update` ya no lleva `userVote`: antes se difundía a todos el voto de quien cerró.
- **Validación del socket (hallazgo).** El `ValidationPipe` global (`APP_PIPE`) no se aplica a los eventos de socket, así que el payload de `request-chat` no se validaba. Ahora el handler usa `createWsValidationPipe()`: rechaza con `WsException('invalid-payload')`, que llega como evento `exception` con el payload en `cause.data`. La App lo usa para marcar el mensaje como no enviado. Todo handler de socket nuevo debe llevar `@UsePipes(createWsValidationPipe())`.
- **App.**
  - **Socket y eventos.** Un solo socket (`services/socket.ts`), que `App` empieza a escuchar en cuanto se conoce `GET /me` (`services/live-updates.ts`). Los eventos parchean la caché de RTK Query con `updateQueryData`. Se eliminaron los slices que la duplicaban (`requestChat` y `hub.requestChats`).
  - **Mensajes optimistas.** Los propios sin confirmar viven en una bandeja aparte (`state/outbox.slice.ts`), así una recarga de la caché no los pierde. Se confirman por `clientMessageId` con el ack o con el evento, lo que llegue primero, sin duplicarse. Si la API los rechaza o no confirma en 10 s, quedan "No enviado · Reintentar".
  - **Votos.** El voto propio se aplica al chat y al listado antes de la respuesta, se corrige con los conteos reales y se revierte si falla.
  - **Reconexión.** Al reconectar se invalida el tag `RequestChat` para recuperar lo perdido durante el corte: es la única recarga.
- **Resuelto en T16:** reintentar un mensaje cuyo primer intento sí se guardó (ack perdido) lo duplicaba; ahora la API guarda el `clientMessageId` con índice único y devuelve el mismo mensaje.

**Dependencies:** T06, T40, T41

**Files likely touched:**
- `src/services/socket.ts` (nuevo)
- `src/services/live-updates.ts` (nuevo)
- `src/state/outbox.slice.ts` (nuevo)
- `src/services/request-chat.service.ts`
- `src/pages/IndexPage/IndexPage.tsx`
- `src/pages/RequestChatPage/RequestChatPage.tsx`

**Estimated scope:** M

### Checkpoint B: Fase 0 completa
- [x] Criterios de éxito 1–5 y 14:
  - **1, 2 y 4:** e2e del Checkpoint A.
  - **3:** build de producción de la App (`main`, 2026-10-03) sin `api.telegram.org`, `VITE_TELEGRAM_BOT_TOKEN` ni tokens de bot.
  - **5:** `test/request-chat-messages.e2e-spec.ts` (20 mensajes concurrentes, en orden y con su `createdAt`).
  - **14:** migración en producción con mensajes 1647/1647 y votos 431/431, y la Mini App de producción abre las solicitudes con sus mensajes.
- [ ] Script de T37 corrido de nuevo y comparado con la línea base (hecho, ver T37); RNF-REN-06, REN-07 y REN-08 cumplidos.
  - **Enviar y votar** cumplen p95 < 500 ms estimado en la API.
  - **Abrir chat** queda en ~500 ms porque trae todo el historial: se resuelve con T18.
  - **REN-08** lo cubren las pruebas de T41.
  - **Falta** la prueba manual con red lenta (REN-06).
- [x] Revisión humana; despliegue de API y App juntas a staging y luego a producción (2026-10-03: API PR #23, App PR #11)

---

## Fase 1 — v1 funcional

## Task 13: Formulario de solicitud (API)

**Repo:** API · **RNF:** SEG-02, SEG-05

**Description:** Entidad `ApplicationForm` y `POST /applications` con los campos de SPEC §3.1. Solo edad (entero > 0) y ciudad son obligatorias (aceptar las reglas se quitó el 2026-10-03). Etiqueta "Menor de edad" si edad < 18. Una solicitud por usuario, sin importar su estado. No editable. El solicitante es el usuario autenticado.

**Acceptance criteria:**
- [x] Segunda solicitud del mismo usuario → 409
- [x] Payload sin edad o ciudad → 400; `requesterUUID` en el body se ignora
- [x] No existe endpoint de edición; un miembro no puede crear solicitud (403)

**Verification:**
- [x] Unitarias de la entidad (menor, unicidad, no editable): `application-form.spec.ts`, `applications.service.spec.ts` y `openRequestChat` en `chat.service.spec.ts`
- [x] e2e de creación (`test/applications.e2e-spec.ts`), incluido un envío triple simultáneo, que deja una sola solicitud

**Notas de implementación:**
- **Modelo.**
  - `ApplicationForm` es un value object en `src/applications/domain`. `submit` valida y normaliza: recorta los textos y descarta los vacíos. No tiene métodos que lo cambien y sus datos quedan congelados.
  - Se guarda embebido en la solicitud (`requestchats.form`), porque hay una solicitud por usuario.
  - Las solicitudes anteriores no tienen `form`: T12 las migra y las marca `legacy`.
- **Endpoint.**
  - `POST /applications`, solo para solicitantes (`@ApplicantsOnly`). Devuelve la solicitud completa (como `GET /request-chats/:id`), así la App navega al chat sin pedirla de nuevo.
  - `requesterUUID` se acepta y se ignora; cualquier otro campo desconocido da 400.
  - Límites: textos cortos de 100 caracteres y largos de 2.000; edad entera de 1 a 120 (el tope solo descarta errores de tipeo).
- **Apertura.** `ChatService.openRequestChat` es el flujo común del endpoint nuevo y del viejo: unicidad, bienvenida, `new-request-chat` y anuncio en el grupo en segundo plano. El anuncio usa el formulario y solo lleva las líneas con valor; escapa el texto del usuario y enlaza a la solicitud con `startapp`. La etiqueta "Menor de edad" no va en el anuncio: se muestra en señales y comentarios de la App.
- **Lectura.** `GET /request-chats/:id` incluye `form` con `isMinor`.
- **Una por usuario.**
  - Además de la lectura previa, `requestchats.requester` pasa a ser índice único: un doble toque en "Enviar" no crea dos solicitudes. El `E11000` se traduce a 409.
  - **Paso manual:** T38 creó `requester_1` no único, y Mongoose no cambia un índice que ya existe. En staging y en producción hay que correr `scripts/requester-unique-index-t13.mjs`. Sin `--apply` solo detecta duplicados; con `--apply` y `CONFIRM=<base>` deja el índice único.
- **`POST /request-chats`** (formulario anterior) se eliminó en T15, cuando la App pasó a este endpoint.

**Dependencies:** T06, T10

**Files likely touched:**
- `src/applications/domain/application-form.ts` (+ `.spec.ts`)
- `src/applications/presentation/dtos/create-application.dto.ts`
- `src/applications/presentation/applications.controller.ts`
- `src/chat/domain/entities/request-chat.entity.ts`
- `scripts/requester-unique-index-t13.mjs`

**Estimated scope:** M

---

## Task 14: Imágenes del formulario

**Repo:** API · **RNF:** SEG-05

**Description:** El formulario acepta 0–3 imágenes JPEG/PNG/WebP de ≤ 10 MB, subidas por `media`. Además se quita `pronouns`, que T13 dejó en el formulario (decidido el 2026-10-03).

**Acceptance criteria:**
- [x] 4 imágenes → 400; MIME no permitido → 400; > 10 MB → 413 (los dos últimos los valida `POST /media`, T08)
- [x] Las imágenes se ven en el resumen vía `/media/:id`
- [x] `pronouns` en el body → 400; desaparece de la entidad, el schema, el mapper y los DTOs (los datos ya guardados se ignoran)

**Verification:**
- [x] Unitarias de la regla de máximo 3 (`application-form.spec.ts`), de `assertOwnUploads` (`media.service.spec.ts`) y del servicio (`applications.service.spec.ts`)
- [x] e2e (`test/applications.e2e-spec.ts`): formulario con 3 imágenes propias que ven el solicitante y un miembro, pero no otro solicitante; 400 con 4 imágenes, repetidas, ids que no son UUID, inexistentes o de otro usuario, y con `pronouns` (criterio de éxito 11, parte de las imágenes)

**Notas de implementación:**
- **Contrato.** La App sube cada imagen con `POST /media` (devuelve `{ id }`) y envía los ids en `POST /applications` como `imageIds` (0–3 UUID, sin repetir, en el orden elegido). `form.imageIds` vuelve en la respuesta y en `GET /request-chats/:id`; la App las muestra con `GET /media/:id`.
- **Reglas.** El máximo de 3 y la no repetición viven en `ApplicationForm` (`MAX_FORM_IMAGES`); el DTO las repite para responder 400 antes de tocar la BD. `MediaService.assertOwnUploads` exige que cada id exista, sea una subida (no un avatar) y la haya subido el solicitante: nadie adjunta la imagen de otro. Si no → 400 y no se crea la solicitud.
- **Quién las ve.** No hizo falta cambiar `visibleWithoutRole`: el solicitante ve sus subidas y un miembro ve todas.
- **Guardado.** `requestchats.form.imageIds` como UUID; el mapper los normaliza a texto (con `lean()` llegan como `Binary`). Sin imágenes el campo no se guarda.
- **Pronombres.** Se quitaron del formulario. Los formularios de staging o producción que los tengan los conservan en la BD, pero el mapper ya no los lee.
- **Pendiente.** Subidas que nunca se usan en un formulario (el solicitante sube y no envía) quedan en `media` y en el canal de almacenamiento. Son pocas y no cuestan nada; no se limpian por ahora.

**Dependencies:** T08, T13

**Files likely touched:**
- `src/applications/domain/application-form.ts` (+ `.spec.ts`)
- `src/applications/application/applications.service.ts` (+ `.spec.ts`)
- `src/applications/presentation/dtos/create-application.dto.ts`, `get-application-form.dto.ts`
- `src/applications/infraestructure/application-form.schema.ts`, `mappers/application-form.mapper.ts`
- `src/media/application/media.service.ts` (+ `.spec.ts`), `src/media/infraestructure/media-mongo.repository.ts`

**Estimated scope:** S

---

## Task 15: App: pantalla Formulario (paso 1 de 3)

**Repo:** App · **RNF:** USA-01, USA-02 · **Deuda:** #13

**Description:** Pantalla *Bienvenida* (presenta FurMeets y los 3 pasos; "Quiero unirme" abre el formulario) y reescribir `RegisterPage` según el artboard *Formulario*: campos opcionales/obligatorios sin pronombres, hasta 3 imágenes (contador "2 de 3"). Sin reglas de convivencia ni avisos de envío definitivo o de que los mensajes se comparten en el grupo (retirados el 2026-10-04). Al enviar, pide `requestWriteAccess` (si lo rechaza, continúa).

**Acceptance criteria:**
- [x] Un usuario sin solicitud ve primero la Bienvenida
- [x] El botón de enviar se bloquea sin edad o ciudad; con 3 imágenes ya no se puede subir otra
- [x] No aparece el texto "puedes editarlo hasta que empiecen a revisarte"
- [x] Tras enviar (`POST /applications`), navega al chat del solicitante
- [x] Ya sin uso desde la App, se elimina `POST /request-chats` de la API (T13). API y App se despliegan juntas

**Verification:**
- [x] `npm run lint` y `npm run build` en la App; `npm test` y `npm run test:e2e` en la API
- [ ] Manual en staging (móvil y escritorio, tema claro y oscuro)

**Notas de implementación:**
- **Ruteo.** Un solicitante sin solicitud entra a `/welcome` (`homePathFor`); "Quiero unirme" abre `/register`, y el botón atrás vuelve a la Bienvenida. Las dos rutas solo las ve un solicitante sin solicitud.
- **Imágenes.** Cada una se sube a `POST /media` al elegirla (`ImagePicker`), con vista previa local, indicador de subida y botón para quitarla. Antes de subir se revisan el tipo (JPEG, PNG o WebP) y el tamaño (10 MB); un 400 o 413 de la API se muestra igual. Enviar espera a que terminen las subidas. La imagen subida queda en la caché de `media.ts`: mostrarla después no la vuelve a descargar.
- **Envío.** `submitApplication` (`POST /applications`) reemplaza a `createRequestChat`. Recorta los textos y omite los vacíos. Antes pide `requestWriteAccess` si Telegram lo permite; si lo rechaza, sigue. Un 409 vuelve a pedir `GET /me`, que lleva a su pantalla.
- **Avisos.** Bajo el botón dice qué falta (edad o ciudad) mientras no se puede enviar. Los avisos de envío definitivo, de que los mensajes se comparten en el grupo y de la etiqueta "Menor de edad" se quitaron a pedido (2026-10-04, miniapp #12).
- **Accesibilidad.** Cada campo tiene `<label>` propio: el `header` de los inputs de telegram-ui no se muestra en iOS.
- **`StepProgress`.** Componente "Paso N de 3", para reusar en el chat del solicitante (T20) y en Aprobado (T26).
- **API.** Se quitaron `POST /request-chats`, `CreateRequestChatDto`, `ChatService.createRequestChat`, `RequestChatEntity.asNew` y `legacyApplication`. Las solicitudes `legacy` ahora solo salen de la migración (T12). Las pruebas que creaban solicitudes por ese endpoint usan `POST /applications`. Una e2e confirma que `POST /request-chats` responde 404.
- **Despliegue.** La App vieja usa `POST /request-chats`: API y App se despliegan juntas.

**Dependencies:** T07, T14

**Files likely touched:**
- App: `src/pages/WelcomePage.tsx` (nuevo), `src/pages/RegisterPage/RegisterPage.tsx`, `src/pages/RegisterPage/ImagePicker.tsx` (nuevo), `src/components/StepProgress.tsx` (nuevo), `src/services/request-chat.service.ts`, `src/services/media.ts`, `src/navigation/*`
- API: `src/chat/presentation/request-chat.controller.ts` (quitar `POST /request-chats`)

**Estimated scope:** M

---

## Task 16: Chat: texto con idempotencia y recuperación

**Repo:** API · **RNF:** CON-02, CON-03, REN-01

**Description:** Evento de envío con `clientMessageId`; ack con el mensaje persistido; reenvíos con el mismo id no duplican. Endpoint/evento para recuperar mensajes posteriores a un id o fecha. Emisión a `request-chat:<id>` y resumen a `members`. Se construye sobre el orden persistir → emitir → notificar de T41.

**Acceptance criteria:**
- [x] Reenviar el mismo `clientMessageId` devuelve el mismo mensaje sin duplicar
- [x] Tras reconectar, el cliente obtiene los mensajes que se perdió
- [x] Longitud de texto validada

**Verification:**
- [x] e2e de idempotencia y reconexión (`test/request-chat-idempotency.e2e-spec.ts`); unitarias del servicio (`chat.service.spec.ts`)

**Notas de implementación:**
- **Idempotencia.**
  - El mensaje guarda `clientMessageId`. Un índice único parcial `{ requestChatId, authorId, clientMessageId }` (solo los que lo tienen) deja un envío por autor e id en cada solicitud.
  - `insertOnce` inserta y, si el índice lo rechaza, lee el ya guardado: un reenvío, aunque llegue a la vez, recibe el mismo mensaje (mismo `uuid` y `sentAt`).
  - Un reenvío no se vuelve a emitir ni a avisar por Telegram (`created: false`).
  - El índice incluye al autor: el mismo id enviado por dos personas son dos mensajes, y nadie recibe el mensaje de otro por adivinar su id.
  - El índice lo crea Mongoose al arrancar. Los mensajes anteriores no tienen el campo y quedan fuera, así que no hace falta migración.
  - Con esto se resuelve el pendiente de T42: la App reintenta con el mismo `clientMessageId` y ya no duplica.
- **`clientMessageId` en el historial.** Viene en el ack, en el evento y en `GET /request-chats/:id`. Tras reconectar, la App puede confirmar con él los mensajes que quedaron "enviando" aunque el ack se haya perdido.
- **Recuperación.**
  - `GET /request-chats/:id/messages?after=<uuid>&limit=` (dueño o miembro) devuelve `{ items, hasMore }`: los mensajes posteriores a `after`, en orden, hasta `limit` (50 por defecto, 100 como máximo).
  - Si `hasMore` es `true`, se vuelve a pedir con `after` = el último. Un `after` de otra solicitud → 400.
  - Usa el índice `requestChatId + createdAt`. La App lo adopta en T20; hoy recarga el chat al reconectar.
- **Validación.** `content` de 1 a 4096 caracteres (límite de un mensaje de Telegram) y no solo espacios. Si no cumple, el socket responde `invalid-payload`.
- **`userUUID`.** Se quitó del DTO del socket: la App ya no lo envía desde T07.

**Dependencies:** T06, T11, T41

**Files likely touched:**
- `src/chat/presentation/chat.gateway.ts`
- `src/chat/application/chat.service.ts` (+ `.spec.ts`)
- `src/chat/presentation/dtos/create-request-chat-message.dto.ts`, `list-request-chat-messages.dto.ts` (nuevo)
- `src/chat/infraestructure/schemas/request-chat-message.schema.ts`, `repositories/request-chat-message-mongo.repository.ts`

**Estimated scope:** M

---

## Task 17: Chat: imágenes

**Repo:** API · **RNF:** SEG-05

**Description:** Mensajes con imágenes (sin límite de cantidad, ≤ 10 MB c/u) vía `media`. (Responder citando un mensaje se planeó aquí y se quitó el 2026-10-04: agrega complejidad para poco valor en chats cortos.)

**Acceptance criteria:**
- [x] Un mensaje lleva texto, imágenes o ambos; las imágenes deben ser subidas del autor
- [x] Las imágenes que manda un miembro las ve el solicitante; otro solicitante no

**Verification:**
- [x] e2e (`test/request-chat-images.e2e-spec.ts`); unitarias de la entidad, del servicio y de `media`
- [x] Prueba de mutación: sin la validación de imágenes propias fallan los casos de imagen ajena e inexistente

**Notas de implementación:**
- **Contrato del socket.** `request-chat` acepta `content?` e `imageIds?` (hasta 10 UUID sin repetir, subidos antes con `POST /media`). Necesita texto o al menos una imagen. El mensaje devuelto (ack, evento, historial y recuperación) trae `imageIds`; `content` queda vacío si es solo imágenes.
- **Reglas.**
  - `RequestChatMessageEntity.send` valida el cuerpo: texto o imágenes, máximo 10 (`MAX_MESSAGE_IMAGES`) y sin repetir.
  - Las imágenes deben ser subidas del autor (`MediaService.assertOwnUploads`, la misma de T14).
  - Si algo falla, el servicio responde 400 y el gateway lo devuelve como `invalid-payload`, igual que un payload mal formado: la App lo marca como no enviado.
- **Quién ve las imágenes del chat.**
  - Las del solicitante ya las veían los miembros.
  - Si escribe un miembro, sus imágenes se comparten con el solicitante (`media.sharedWith`, con `$addToSet`) antes de emitir el mensaje, así el solicitante puede abrirlas en cuanto lo recibe. Otro solicitante sigue recibiendo 403.
  - `media` no depende de `chat`: guarda a quién se compartió, sin consultar la solicitud.
- **Avisos de Telegram.** Si el mensaje es solo imágenes, el aviso al grupo dice "📷 Imagen" o "📷 N imágenes" (`preview`). Republicar las imágenes en el grupo es T27.
- **Costo.** Un mensaje de texto sigue con 2 operaciones de Mongo. Las imágenes suman su validación y, si escribe un miembro, compartirlas.
- **Sin migración.** `content` deja de ser obligatorio en el schema; los mensajes anteriores no cambian.

**Dependencies:** T08, T16

**Files likely touched:**
- `src/chat/domain/entities/request-chat-message.entity.ts` (+ `.spec.ts`)
- `src/chat/mappers/request-chat-message.mapper.ts`, `infraestructure/schemas/request-chat-message.schema.ts`, `repositories/request-chat-message-mongo.repository.ts`
- `src/chat/application/chat.service.ts` (+ `.spec.ts`), `presentation/chat.gateway.ts`, `presentation/dtos/*message*.dto.ts`
- `src/media/domain/media.ts`, `application/media.service.ts`, `infraestructure/media*.ts`

**Estimated scope:** S

---

## Task 18: Chat: historial paginado

**Repo:** API + App · **RNF:** REN-04

**Description:** Historial de mensajes de un chat paginado: abrir un chat trae los últimos mensajes y los anteriores se piden por páginas. (El resumen del listado se hace en T40. Los leídos y no leídos se quitaron el 2026-10-03, SPEC §15.)

**Acceptance criteria:**
- [x] Abrir un chat con muchos mensajes trae solo la última página
- [x] Las páginas anteriores no repiten ni saltan mensajes

**Verification:**
- [x] e2e (`test/request-chat-history.e2e-spec.ts`): 121 mensajes, recorridos hacia atrás de a 50 y de a 7, con `createdAt` empatados; unitarias del servicio
- [x] Prueba de mutación: sin el desempate por `_id`, las páginas repiten o saltan mensajes y fallan 3 casos
- [ ] App: manual en staging con un chat de más de 50 mensajes

**Notas de implementación:**
- **Contrato.**
  - `GET /request-chats/:id` (y `POST /applications`, `new-request-chat`, `request-chat-update`) trae los últimos 50 mensajes (`LATEST_MESSAGES_LIMIT`) y `hasOlderMessages`.
  - Los anteriores: `GET /request-chats/:id/messages?before=<primer mensaje>&limit=` (por defecto 50, máximo 100) → `{ items, hasMore }`, en orden cronológico.
  - La misma ruta sigue sirviendo `?after=` (recuperación, T16). Lleva uno de los dos: ambos o ninguno → 400. Un mensaje de otra solicitud → 400.
- **Orden estable.** Los mensajes nuevos tienen `createdAt` único (reloj monótono), pero los migrados sin fecha propia (T12) comparten la de su solicitud. El orden es `createdAt` y después `_id`, y el cursor compara los dos: las páginas no repiten ni saltan mensajes aunque empaten. Aplica también a `after`.
- **Índice.** `requestChatId + createdAt` pasa a `requestChatId + createdAt + _id`, que sirve los dos sentidos y el último mensaje del listado. Mongoose crea el nuevo al arrancar. El anterior quedó redundante y se borró en staging y producción el 2026-10-05, después de crear el nuevo.
- **Cierre.** El `request-chat-update` del cierre ya no lee todo el historial: lleva la última página, igual que abrir el chat.
- **App (mínimo, el chat completo es T20).**
  - Botón "Ver mensajes anteriores" arriba del chat mientras haya `hasOlderMessages`.
  - La vista no se mueve al agregar mensajes anteriores.
  - Desplazamiento: el chat abre mostrando lo último y baja al enviar un mensaje propio. Los mensajes que llegan de otros no mueven la vista; bajar con cada mensaje nuevo resultaba molesto.
  - `request-chat-update` agrega los mensajes nuevos sin borrar las páginas ya cargadas. Si no se solapa con lo que hay, reemplaza todo.

**Dependencies:** T16

**Files likely touched:**
- `src/chat/application/chat.service.ts`, `domain/services/request-chat-message.repository.ts`
- `src/chat/infraestructure/repositories/request-chat-message-mongo.repository.ts`, `schemas/request-chat-message.schema.ts`
- `src/chat/presentation/request-chat.controller.ts`, `dtos/list-request-chat-messages.dto.ts`, `dtos/get-request-chat.dto.ts`, `chat.gateway.ts`
- App: `src/pages/RequestChatPage/RequestChatPage.tsx`, `src/services/request-chat.service.ts`, `src/services/live-updates.ts`

**Estimated scope:** S

---

## Task 19: Chat: sin mensajes del bot y solo lectura

**Repo:** API + App

**Description:** El bot no escribe en el chat. El chat empieza con un encabezado de bienvenida de la App y el resultado se comunica en la pantalla *Aprobado* o *No aprobado*. Tras el cierre, cualquier envío se rechaza. (Cambio de alcance del 2026-10-05: antes eran mensajes de sistema del bot, de bienvenida y de resultado. "X entró al chat de revisión" también se quitó, porque solo informaría que alguien entró.)

**Acceptance criteria:**
- [x] Enviar a una solicitud cerrada → error `RequestChatClosed`
- [x] Una solicitud nueva no tiene mensajes, y cerrarla no agrega ninguno
- [x] La App muestra la bienvenida como encabezado al inicio del chat
- [ ] Los mensajes del bot que ya existen se quitan en staging y producción (migración 002). Staging: hecho el 2026-10-05 (8 mensajes de `@furmeets_test_bot`, respaldados en `requestchatmessages_bot_pre_002`). Falta producción.

**Verification:**
- [x] Unitarias de la entidad y del servicio
- [x] e2e (`test/request-chat-read-only.e2e-spec.ts`):
  - envío a solicitud cerrada, del solicitante y de un miembro;
  - el historial se sigue leyendo;
  - migración 002: modo lectura, aplicada con respaldo, idempotente y con un bot inexistente.
- [x] e2e de solicitud nueva y de cierre por votos sin mensajes del bot
- [x] Prueba de mutación: sin la regla de solo lectura fallan 3 casos
- [ ] App: manual en staging (encabezado al abrir un chat nuevo y al llegar al principio del historial)

**Notas de implementación:**
- **Sin mensajes del bot.**
  - `openRequestChat` crea la solicitud sin mensajes.
  - Al cerrar, `afterClose` ya no inserta un mensaje: solo emite `request-chat-update`, con la última página como antes, y manda los avisos de Telegram.
  - El usuario del bot (`getBotUser`, `refreshBotUser`, `UserEntity.registerBot`) existía solo para firmar esos mensajes y se quitó.
  - El documento del bot que ya está en `users` no se toca.
  - Los avisos al grupo de Telegram (solicitud nueva, aprobada, rechazada) siguen igual: no son mensajes del chat.
- **Solo lectura.**
  - `RequestChatEntity.assertAcceptsMessages` lanza `RequestChatClosedError` si la solicitud no está en curso.
  - Por socket llega como `exception` con `message: 'request-chat-closed'` y el payload en `cause.data`, así la App marca el mensaje como no enviado con su `clientMessageId`.
  - No se guarda, no se emite y no se avisa por Telegram. Leer el historial sigue funcionando.
  - Antes respondía "Internal server error" en el socket (un `ConflictException` sin traducir).
  - Un reenvío de un mensaje que sí se guardó antes del cierre (ack perdido) también recibe `request-chat-closed`. Al reconectar, el historial lo muestra.
- **Migración 002 (`scripts/migrations/002-drop-bot-messages.ts`).**
  - Quita del chat los mensajes del bot anteriores a T19, después de copiarlos en `requestchatmessages_bot_pre_002`.
  - Correrla después de desplegar, primero sin `--apply` para revisar el bot y el conteo.
  - `BOT_TELEGRAM_ID` es el número antes de `:` en el token del bot de esa base:
    ```
    DB_URI=... BOT_TELEGRAM_ID=<id> npm run migrate:002
    DB_URI=... BOT_TELEGRAM_ID=<id> CONFIRM=<base> npm run migrate:002 -- --apply
    ```
  - Correrla de nuevo no cambia nada.
  - Una solicitud que solo tenía la bienvenida queda sin mensajes, igual que una nueva. En el listado se ve sin último mensaje.
- **App.**
  - Encabezado de bienvenida al inicio del chat, cuando ya no hay mensajes anteriores por cargar (`!hasOlderMessages`). Lo ven el solicitante y los miembros.
  - Un chat sin mensajes muestra solo el encabezado.

**Dependencies:** T16

**Files likely touched:**
- `src/chat/domain/entities/request-chat.entity.ts`, `request-chat-message.entity.ts` (+ `.spec.ts`)
- `src/chat/application/chat.service.ts` (+ `.spec.ts`), `presentation/chat.gateway.ts`
- `src/members/application/user.service.ts`, `groups.service.ts`, `domain/entities/user.entity.ts`
- `scripts/migrations/002-drop-bot-messages.ts`
- App: `src/pages/RequestChatPage/RequestChatPage.tsx`

**Estimated scope:** S

---

## Task 20: App: chat del solicitante y chat de miembros

**Repo:** App · **RNF:** REN-01, CAL-04, USA-01, USA-02

**Description:** Chat con texto, imágenes (adjuntar), estado de solo lectura, envío con `clientMessageId` y recuperación al reconectar. Fechas formateadas en el cliente. Sin botones de emoji ni micrófono.

**Acceptance criteria:**
- [ ] Un mensaje enviado aparece en otro cliente conectado sin recargar
- [ ] Al cortar y restablecer la red, no se pierden ni duplican mensajes
- [ ] Chat cerrado: sin caja de texto
- [ ] El solicitante ve "Paso 2 de 3 · conversación con el grupo" y ninguna votación

**Verification:**
- [ ] Manual en staging con dos cuentas (los criterios se marcan con ella; lint y build en verde)

**Notas de implementación** (App, `feat/t20-chat`):
- **Imágenes.**
  - Adjuntar hasta 10 por mensaje. Cada una sube a `POST /media` al elegirla y queda como miniatura que se puede quitar. Enviar espera a que terminen las subidas (`ChatComposer`).
  - En la burbuja, una imagen ocupa el ancho y varias van en dos columnas. Al tocarla se abre a pantalla completa.
  - El listado muestra "📷 Imagen" si el último mensaje es solo imágenes (`messagePreview`).
- **Diseño** (artboards *Solicitante* y *Main*).
  - Burbujas: las propias a la derecha con hora y doble check (guardado, no leído); las ajenas con avatar y un color de nombre fijo por autor.
  - Caja: adjuntar, texto y enviar.
  - Cabecera del solicitante: "FurMeets · tu solicitud" y la barra "Paso 2 de 3 · conversación con el grupo · en revisión".
  - La cabecera de miembros queda igual: la votación plegada y la tarjeta de resumen son T24.
  - Los colores salen del tema de Telegram (`themeParams`), así el chat funciona en tema claro y oscuro.
- **Solo lectura.** Con la solicitud cerrada no hay caja de texto: se ve "La solicitud se cerró: el chat es de solo lectura". Un envío rechazado con `request-chat-closed` queda "no enviado".
- **Reconexión.**
  - Al reconectar, la App pide de nuevo el chat abierto y reenvía los mensajes propios que seguían "enviando", con el mismo `clientMessageId` (la API devuelve el ya guardado, T16).
  - Si el historial trae un mensaje propio pendiente (ack perdido), sale de la bandeja de salida, así no se ve dos veces.
  - Los "no enviado" esperan a que el usuario los reintente.

**Dependencies:** T07, T09, T17, T18, T19

**Files likely touched:**
- `src/pages/RequestChatPage/RequestChatPage.tsx`
- `src/components/ChatBubble/ChatBubble.tsx`, `src/components/ChatComposer/ChatComposer.tsx`
- `src/services/live-updates.ts`, `src/state/outbox.slice.ts`
- `src/models/request-chat-message.model.ts`, `src/components/RequestChatList/RequestChatList.tsx`

**Estimated scope:** M

### Checkpoint C: solicitud y chat
- [ ] Flujo formulario → chat en staging
- [x] Criterio de éxito 11 (`test/applications.e2e-spec.ts`: más de 3 imágenes → 400; `PUT`/`PATCH` → 404)

---

## Task 45: Corregir `ValueObject.equals`

**Repo:** API · **RNF:** CAL-03 · **Deuda:** #19

**Description:** `ValueObject.equals` devuelve `true` para cualquier par de objetos con `props`: no compara valores (hallazgo de T41). T21 y T22 comparan votantes y autores, así que se corrige antes. Comparar `props` por valor (superficial, con recursión en value objects anidados) y revisar quién lo usa hoy.

**Acceptance criteria:**
- [x] Dos value objects con las mismas `props` son iguales; con `props` distintas, no
- [x] Los usos actuales siguen funcionando (o se cambian si dependían del bug)

**Verification:**
- [x] Unitarias de `value-object.spec.ts` (fallaban 7 de 8 con el código anterior); `npm test` (229) y `npm run test:e2e` (168) completos

**Notas de implementación:**
- **Igualdad por valor.** Misma clase y mismas `props`, comparadas una a una:
  - los value objects anidados, con su propio `equals`;
  - las listas, elemento por elemento y en orden;
  - las fechas, por instante;
  - lo demás, con `Object.is`.
- Una prop ausente equivale a una en `undefined`, así `{ text }` es igual a `{ text, author: undefined }`. Dos clases distintas con las mismas `props` no son iguales.
- **Usos actuales.** Ningún código de `src` llamaba a `ValueObject.equals`, así que nada dependía del bug. `Entity.equals`, que usan `fromUser` y `GroupEntity`, compara `_id.value` como texto y no cambia. Desde ahora, `UUID.equals` compara el valor; T21 y T22 pueden usarlo para votantes y autores.

**Dependencies:** Ninguna

**Files likely touched:**
- `src/shared/domain/value-objects/value-object.ts` (+ `.spec.ts`)

**Estimated scope:** XS

---

## Task 21: Revisión: votos y umbrales

**Repo:** API · **RNF:** SEG-04, PRI-01, PRI-02, PRI-03, CON-07 · **Deuda:** #11

**Description:** Votar (`approve | reject`), cambiar y retirar mientras está en curso. Umbrales `APPROVE_THRESHOLD`/`REJECT_THRESHOLD`, los dos en 5; el voto que alcanza uno cierra en el acto (actualización condicional para evitar doble cierre). Para los miembros, las respuestas incluyen quién votó a favor y quién en contra, los conteos, los umbrales y el voto propio. Para el solicitante no incluyen votos (decidido el 2026-10-03: nada es anónimo dentro del grupo).

**Acceptance criteria:**
- [ ] Solicitante votando → 403; `vote` inválido → 400
- [ ] Al alcanzar el umbral, la solicitud pasa a *Approved*/*Rejected* una sola vez
- [ ] Un miembro recibe los nombres de los votos a favor y en contra, en `GET /request-chats/:id`, en la respuesta del voto y en el evento `request-chat-votes` (que hoy solo lleva conteos, T42)
- [ ] Mientras no sea miembro, el solicitante no recibe votos ni en `GET` ni en `request-chat-update`
- [ ] El valor por defecto de `REJECT_THRESHOLD` en el código pasa de 3 a 5 (`request-chat.entity.ts`); revisar el valor en Render de staging y producción (cambiarlo requiere aprobación, SPEC §12)

**Verification:**
- [ ] Unitarias de dominio (umbrales, cambio, retiro, no votar la propia)
- [ ] Prueba que serializa las salidas dirigidas al solicitante y no encuentra votos (criterio de éxito 10)

**Dependencies:** T11, T06, T45

**Files likely touched:**
- `src/review/domain/vote.ts` (+ `.spec.ts`)
- `src/chat/domain/entities/request-chat.entity.ts`
- `src/chat/mappers/request-chat.mapper.ts`
- `src/chat/presentation/request-chat.controller.ts`

**Estimated scope:** M

---

## Task 22: Revisión: avales y comentarios

**Repo:** API · **RNF:** PRI-01, PRI-03

**Description:** "Lo conozco, lo avalo" (aval informativo, cualquier miembro, con opción de retirarlo) y comentarios entre miembros. Avales y comentarios llevan el nombre de su autor y la fecha, y los ven todos los miembros. El solicitante no ve ninguno de los dos mientras no sea miembro.

**Acceptance criteria:**
- [ ] Solicitante pidiendo avales o comentarios → 403
- [ ] Avales y comentarios traen autor y fecha
- [ ] Avalar dos veces no duplica; retirar el aval lo quita

**Verification:**
- [ ] Unitarias; e2e por rol (criterios de éxito 9 y 10)

**Dependencies:** T21

**Files likely touched:**
- `src/review/domain/endorsement.ts`, `comment.ts`
- `src/review/presentation/review.controller.ts`
- `src/review/infraestructure/schemas/*.ts`

**Estimated scope:** M

---

## Task 23: App: inicio de miembros

**Repo:** API + App · **RNF:** PRI-02, REN-04, USA-01

**Description:** Inicio según el artboard *Inicio*: todas las solicitudes en curso con su estado, conteos contra los umbrales ("4/5 a favor · 1/5 en contra") y la etiqueta "Falta tu voto"; estadísticas (total, aceptadas, no aprobadas); historial paginado. Actualización en vivo por la sala `members`. Además, abrir la App con `startapp=<id>` (el enlace del aviso al grupo, T41) lleva directo a esa solicitud.

**API:** hoy `GET /request-chats` está paginado por cursor (T40) y no trae totales, así que la App no puede calcular las estadísticas ni separar "en curso" del historial. Agregar los totales por estado y un filtro por estado (o la lista de en curso aparte), con agregaciones sobre índices.

**Acceptance criteria:**
- [ ] Las estadísticas coinciden con los conteos por estado en la BD, aunque el historial esté paginado
- [ ] Un mensaje o voto nuevo actualiza la lista sin recargar; no se lista quién falta por votar
- [ ] `startapp=<id>` abre esa solicitud (si el usuario puede verla; si no, el inicio)

**Verification:**
- [ ] e2e de la forma de la respuesta y de los totales (API)
- [ ] `npm run lint` y `npm run build` en la App; manual en staging

**Dependencies:** T18, T21

**Files likely touched:**
- API: `src/chat/presentation/request-chat.controller.ts`, `src/chat/infraestructure/repositories/chat-mongo.repository.ts`, `dtos/list-request-chat.dto.ts`
- App: `src/pages/IndexPage/IndexPage.tsx`, `src/components/RequestChatList/RequestChatList.tsx`, `src/components/App.tsx` (`startapp`)

**Estimated scope:** M

---

## Task 24: App: votación y resumen del solicitante

**Repo:** App · **RNF:** PRI-01, USA-01

**Description:** Votación plegada con dos barras, una por opción, hacia los umbrales fijos (sin estado *Vencida*). Abierta muestra quién votó aceptar y quién rechazar, y el texto "tu voto lo ve todo el grupo". Resumen con fursona, datos, respuestas, avales, comentarios con su autor y leyenda de solicitud migrada. Sin pronombres ni *Reportar solicitud*.

En el chat de miembros, una tarjeta "Resumen del solicitante" (especie · edad · ciudad · avales) abre el Resumen. El Resumen muestra la etiqueta "Menor de edad" cuando corresponde y las imágenes del formulario por `/media/:id`.

**Acceptance criteria:**
- [ ] El solicitante no ve el panel de votación
- [ ] Los nombres de quienes votaron aparecen agrupados por opción
- [ ] Cambiar y retirar el voto funciona desde la UI
- [ ] Solicitudes `legacy` muestran "Solicitud anterior al formulario actual"

**Verification:**
- [ ] Manual en staging

**Dependencies:** T22, T23

**Files likely touched:**
- `src/pages/RequestChatPage/RequestChatPage.tsx`
- `src/pages/RequestSummaryPage/RequestSummaryPage.tsx` (nuevo)
- `src/components/VotePanel/VotePanel.tsx` (nuevo)

**Estimated scope:** M

### Checkpoint D: revisión
- [ ] Criterios de éxito 9 y 10
- [ ] Revisión humana: el solicitante no recibe votos, avales ni comentarios mientras no sea miembro

---

## Task 25: Admisión por solicitud de unión

**Repo:** API · **RNF:** SEG-09, SEG-10 · **Deuda:** #8

**Description:** Al aprobarse, `createChatInviteLink({ creates_join_request: true, name: <id> })`, guardar el enlace (sin caducidad). Handler de `chat_join_request`: aprueba solo si el usuario tiene solicitud aprobada, marca *ingresó* y revoca el enlace; en cualquier otro caso rechaza.

**Acceptance criteria:**
- [ ] El aprobado es aceptado; otra cuenta con el mismo enlace es rechazada
- [ ] Tras el ingreso, el enlace queda revocado y se invalida la caché de membresía del usuario (su siguiente `GET /me` devuelve `member`)
- [ ] Se elimina el enlace con `member_limit: 1`

**Verification:**
- [ ] e2e con el bot simulado (criterio de éxito 6)

**Dependencies:** T21

**Files likely touched:**
- `src/admission/application/admission.service.ts` (+ `.spec.ts`)
- `src/telegram-bot/telegram-bot.service.ts`
- `src/chat/domain/value-objects/request-chat-state.value-object.ts`

**Estimated scope:** M

---

## Task 26: App: pantallas Aprobado y No aprobado

**Repo:** App · **RNF:** USA-01

**Description:** *Aprobado* (paso 3 de 3) con el enlace y sin reglas de convivencia; *No aprobado* sin prometer reintento.

**Acceptance criteria:**
- [ ] El enlace abre la solicitud de unión en Telegram
- [ ] Aprobado no enlaza a reglas de convivencia
- [ ] El texto de No aprobado no menciona reintentar con un aval

**Verification:**
- [ ] Manual en staging

**Dependencies:** T07, T25

**Files likely touched:**
- `src/pages/ApprovedPage/ApprovedPage.tsx` (nuevo)
- `src/pages/RejectedPage/RejectedPage.tsx` (nuevo)
- `src/navigation/routes.tsx`

**Estimated scope:** S

---

## Task 27: Puente: anuncios y republicación en el grupo

**Repo:** API · **RNF:** CON-04, OBS-01

**Description:** Anunciar cada nueva solicitud en el grupo con resumen y deep link. Republicar cada mensaje del solicitante (texto e imágenes reutilizando `file_id`) con encabezado "Nombre · solicitud", guardando el `message_id` del grupo. Todo fuera del camino crítico, con log de errores.

**Acceptance criteria:**
- [ ] Cada mensaje del solicitante aparece en el grupo
- [ ] Si Telegram falla, el mensaje igual queda persistido y emitido

**Verification:**
- [ ] e2e con Telegram simulado que falla; manual en staging (criterio de éxito 7, parte 1)

**Dependencies:** T17

**Files likely touched:**
- `src/telegram-bridge/application/bridge.service.ts` (+ `.spec.ts`)
- `src/shared/async/background-queue.ts` (cola de T41)
- `src/chat/application/chat.service.ts`

**Estimated scope:** M

---

## Task 28: Puente: respuestas desde el grupo

**Repo:** API

**Description:** Un *reply* de un miembro al mensaje republicado crea un mensaje en el chat de la solicitud a su nombre. Si el autor no es miembro, se ignora.

**Acceptance criteria:**
- [ ] El reply aparece en la MiniApp en tiempo real
- [ ] Un reply de un no miembro no crea nada

**Verification:**
- [ ] e2e con update simulado (criterio de éxito 7, parte 2)

**Dependencies:** T27, T05

**Files likely touched:**
- `src/telegram-bridge/presentation/group-reply.handler.ts`
- `src/telegram-bot/telegram-bot.service.ts`

**Estimated scope:** S

---

## Task 29: Puente: DMs, resultados y `/faq`

**Repo:** API · **RNF:** CON-04, PRI-03, OBS-01 · **Deuda:** #7

**Description:** DM al solicitante cuando escribe un miembro (si hay permiso). Anuncio en el grupo y DM al cerrar una solicitud. `/faq` responde un placeholder. El DM al solicitante no incluye votos, avales ni comentarios.

**Acceptance criteria:**
- [ ] Sin permiso de DM, el mensaje se entrega por socket igual (criterio de éxito 8)
- [ ] El DM de resultado al solicitante no nombra a quienes votaron

**Verification:**
- [ ] e2e con Telegram simulado que falla

**Dependencies:** T27, T21

**Files likely touched:**
- `src/telegram-bridge/application/bridge.service.ts`
- `src/telegram-bot/telegram-bot.service.ts`
- `src/chat/application/chat.service.ts`

**Estimated scope:** M

### Checkpoint E: v1 funcional
- [ ] Criterios de éxito 6, 7 y 8
- [ ] Flujo completo en staging con bot y grupo de prueba

---

## Fase 2 — Rendimiento e infraestructura

## Task 30: Webhook con `secret_token`

**Repo:** API · **RNF:** SEG-07, SEG-10

**Description:** Migrar grammY de polling a webhook en `/telegram/webhook`, registrado con `PUBLIC_API_URL` y `TELEGRAM_WEBHOOK_SECRET`. Validar el header del secreto.

**Acceptance criteria:**
- [ ] Sin header o con secreto incorrecto → 401
- [ ] El bot responde igual que con polling; `setWebhook` incluye `chat_member` y `chat_join_request` en `allowed_updates`

**Verification:**
- [ ] e2e del endpoint; manual en staging

**Dependencies:** T29

**Files likely touched:**
- `src/telegram-bot/telegram-bot.server.ts`
- `src/telegram-bot/telegram-bot.controller.ts`
- `src/main.ts`

**Estimated scope:** M

---

## Task 31: Keep-alive condicional

**Repo:** API · **RNF:** OPE-02

**Description:** Al arrancar y al crear o cerrar una solicitud, activar un ping cada 10 min a `PUBLIC_API_URL` si hay solicitudes *InProgress*; cancelarlo si no. Solo en producción.

**Acceptance criteria:**
- [ ] Con solicitudes en curso, el ping está activo; sin ellas, no
- [ ] Desactivado en staging por configuración

**Verification:**
- [ ] Unitarias con temporizadores simulados; observación en producción (criterio de éxito 13)

**Dependencies:** T13, T30

**Files likely touched:**
- `src/platform/keep-alive.service.ts` (+ `.spec.ts`)
- `src/app.module.ts`

**Estimated scope:** S

---

## Task 32: CORS restringido y validación de configuración

**Repo:** API · **RNF:** SEG-06, SEG-08, OPE-05

**Description:** CORS con la lista de orígenes de la App del ambiente (sin `*`). Esquema Joi para todas las variables de SPEC §5, incluidas las nuevas.

**Acceptance criteria:**
- [ ] Sin `FRONTEND_URL` la app no arranca
- [ ] Origen no permitido no recibe cabeceras CORS

**Verification:**
- [ ] Unitarias del esquema; e2e de CORS

**Dependencies:** None

**Files likely touched:**
- `src/main.ts`
- `src/app.module.ts`
- `src/platform/env.schema.ts`

**Estimated scope:** S

---

## Task 33: Dockerfile multi-etapa y versión de Node

**Repo:** API · **RNF:** OPE-04 · **Deuda:** #15

**Description:** Build multi-etapa (compila con devDependencies, ejecuta solo con producción). Misma Node LTS en Dockerfile y CI.

**Acceptance criteria:**
- [ ] `docker build` termina y la imagen arranca
- [ ] Versión de Node idéntica en Dockerfile y workflows

**Verification:**
- [ ] `docker build . && docker run` local

**Dependencies:** None

**Files likely touched:**
- `Dockerfile`
- `.nvmrc` / workflows de CI

**Estimated scope:** S

---

## Task 34: Ambientes staging/producción aislados

**Repo:** API + App · **RNF:** OPE-03, REN-05

**Description:** Workflow de GitHub Pages disparado por `development`; staging con bot, grupo, proyecto Atlas y servicio Render propios; API y Atlas en la misma región. Corregir `README` y `homepage` de la App.

**Acceptance criteria:**
- [ ] Push a `development` despliega solo staging; push a `main` solo producción
- [ ] Ningún recurso compartido entre ambientes

**Verification:**
- [ ] Manual: despliegue de prueba en cada rama (criterio de éxito 15)

**Dependencies:** None (requiere aprobación: cambia CI/CD y Render/Atlas)

**Files likely touched:**
- `furmeets-mini-app/.github/workflows/github-pages-deploy.yml`
- `furmeets-mini-app/package.json`, `README.md`
- `README.md`

**Estimated scope:** S

---

## Task 35: Verificación de rendimiento

**Repo:** API + App · **RNF:** REN-01, REN-02, REN-07

**Description:** Verificación final de rendimiento con la v1 completa, extendiendo el script de T37: latencia de entrega de mensajes entre dos clientes (p95), carga inicial de la App e interacciones. Incluye medir el arranque en frío con el webhook y el keep-alive ya activos. Corregir regresiones si no se cumplen las metas.

**Acceptance criteria:**
- [ ] p95 de entrega < 1 s y de enviar, votar y abrir chat < 500 ms con el servidor despierto
- [ ] Carga inicial < 2 s con el servidor despierto
- [ ] Tiempo de arranque en frío medido y anotado

**Verification:**
- [ ] Resultados del script y de DevTools anotados en este documento (criterio de éxito 12)

**Dependencies:** T20, T30, T31, T37

**Files likely touched:**
- `scripts/perf/latency-baseline.ts`

**Estimated scope:** S

---

## Task 36: Limpieza de la App

**Repo:** App · **Deuda:** #13

**Description:** Quitar el código muerto de `POST /users` en la App y los estilos de depuración (`backgroundColor: 'red'`). (TonConnect se quita en T43.)

**Acceptance criteria:**
- [ ] Sin referencias a `createUser` ni estilos de depuración

**Verification:**
- [ ] `npm run build`

**Dependencies:** T07

**Files likely touched:**
- `src/services/user.service.ts`
- `src/pages/RegisterPage/RegisterPage.tsx`

**Estimated scope:** S

---

## Task 44: App: pantalla de carga durante el arranque en frío

**Repo:** App · **RNF:** USA-01, USA-02

**Description:** Reemplazar el spinner de `LoadingPage` por el artboard *Carga*: mientras `GET /me` no responde, una barra cuenta hasta 60 s y rotan mensajes cada 6 s (ninguno menciona reglas de convivencia). Pasados 60 s, cambia a "Esto está tardando más de lo normal" con *Reintentar* y "Contactar a un admin" (`https://t.me/DarvandFrovonwill`). En cuanto la API responde, salta a su pantalla sin esperar a la barra. Respeta `prefers-reduced-motion`.

**Acceptance criteria:**
- [ ] Con la API despierta, la pantalla de carga apenas se ve (no hay espera artificial)
- [ ] A los 60 s sin respuesta aparece el estado demorado; *Reintentar* vuelve a pedir `GET /me`
- [ ] Con movimiento reducido no hay animaciones

**Verification:**
- [ ] Manual en staging con la API dormida

**Dependencies:** T07

**Files likely touched:**
- `src/pages/LoadingPage.tsx`
- `src/pages/StartupErrorPage.tsx`
- `src/components/App.tsx`

**Estimated scope:** S

### Checkpoint F: completo
- [ ] Los 15 criterios de éxito de SPEC §13
- [ ] Todos los RNF de [plan.md](plan.md) verificados
- [ ] Revisión humana y merge a `main`
