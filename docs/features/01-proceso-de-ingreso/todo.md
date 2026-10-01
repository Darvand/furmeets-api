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
- [ ] El token anterior ya no responde (`getMe` → 401)
- [ ] El token nuevo solo existe en las variables de Render (API) y en `.env` local
- [ ] No hay `VITE_TELEGRAM_BOT_TOKEN` en Vercel ni en GitHub

**Verification:**
- [ ] Manual: `curl https://api.telegram.org/bot<viejo>/getMe` falla; el bot sigue respondiendo con el nuevo

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
- [ ] La línea base queda anotada abajo, con fecha

**Verification:**
- [ ] Correr el script dos veces en staging y obtener números consistentes

**Dependencies:** None

**Files likely touched:**
- `src/shared/interceptors/timing.interceptor.ts`
- `src/chat/presentation/chat.gateway.ts`
- `src/main.ts`
- `scripts/perf/latency-baseline.ts`

**Estimated scope:** S

**Línea base (por completar):** arranque — · abrir chat — · enviar — · votar —

**Cómo medirla:** con el servidor de staging desplegado, correr dos veces
`PERF_BASE_URL=<url-staging> PERF_TELEGRAM_ID=<id-de-prueba> PERF_CHAT_ID=<uuid-chat-de-prueba> PERF_WRITES=1 npm run perf:baseline`
y pegar aquí la línea final que imprime (p50 / p95). Sin `PERF_WRITES=1` solo mide arranque y abrir chat; enviar y votar escriben en la BD y notifican por Telegram, así que van contra un chat de prueba en curso al que le falten al menos 2 votos para el umbral. Las variables y precauciones están al inicio de `scripts/perf/latency-baseline.ts`. El desglose Mongo / Telegram de cada petición sale en las líneas `Timing` de los logs del servidor, p. ej. `HTTP GET /request-chats/:id 200 132ms (mongo 95ms/3 · telegram 0ms/0)`.

---

## Task 38: Índices y lecturas livianas

**Repo:** API · **RNF:** REN-07

**Description:** Hoy ningún schema declara índices, y `users.telegramId` se busca en cada petición. Agregar índices en `users.telegramId` (único), `groups.telegramId` y `requestchats.requester`. Usar `lean()` y proyecciones en lecturas que no necesitan documentos de Mongoose. Eliminar la doble búsqueda del usuario en `GET /users/:telegramId` (middleware + controller).

**Acceptance criteria:**
- [ ] `explain()` de las tres búsquedas usa índice (`IXSCAN`), no `COLLSCAN`
- [ ] `GET /users/:telegramId` hace una sola consulta a `users`
- [ ] Los índices se crean sin error sobre los datos existentes (sin `telegramId` duplicados)

**Verification:**
- [ ] `explain()` en staging; logs de T37 antes y después

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
- [ ] `npm test` y `npm run test:e2e` corren; la BD de e2e corre en memoria con `mongodb-memory-server`, aislada de la de desarrollo
- [ ] Existe un helper `signInitData(user, botToken)` reutilizable
- [ ] Un body con campos no declarados en el DTO o con tipos inválidos → 400

**Verification:**
- [ ] `npm run test:e2e` pasa con una prueba de humo (`GET /` → 200) y una de validación (`vote/:type` inválido → 400)

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
- [ ] Criterios de éxito 1, 2 y 4 cubiertos por e2e
- [ ] Revisión humana antes de seguir

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
- [ ] `GET /media/:id` sin auth → 401; con auth de un usuario no autorizado para esa imagen → 403
- [ ] Ninguna respuesta de la API contiene `api.telegram.org/file/bot`
- [ ] Los usuarios guardan `avatarFileId` en lugar de `file_path`

**Verification:**
- [ ] Unitarias del servicio con el cliente de Telegram simulado
- [ ] e2e: subida y descarga

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
- [ ] `grep -r "api.telegram.org" dist/` y `grep -r "VITE_TELEGRAM_BOT_TOKEN"` vacíos
- [ ] Avatares e imágenes se ven igual que antes

**Verification:**
- [ ] `npm run build` + grep sobre `dist/` (criterio de éxito 3)

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
- [ ] 20 mensajes concurrentes en el mismo chat → 20 persistidos, en orden, con su `createdAt`
- [ ] El documento de la solicitud ya no embebe mensajes
- [ ] Las respuestas devuelven fechas ISO UTC, sin formateo de zona en el servidor

**Verification:**
- [ ] e2e de concurrencia (criterio de éxito 5)

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
- [ ] Ningún método del repositorio reescribe el documento completo
- [ ] Un `GET` no modifica la BD
- [ ] Votos concurrentes de miembros distintos quedan todos guardados

**Verification:**
- [ ] Unitarias del servicio; e2e de votos concurrentes

**Dependencies:** T10

**Files likely touched:**
- `src/chat/infraestructure/repositories/chat-mongo.repository.ts`
- `src/chat/domain/services/chat.repository.ts`
- `src/chat/application/chat.service.ts`

**Estimated scope:** M

---

## Task 12: Migración de datos existentes

**Repo:** API · **RNF:** CON-06, PRI-05

**Description:** Script versionado e idempotente según SPEC §9.1: mueve mensajes embebidos a la colección nueva conservando `_id`, `viewedBy` → `readBy`, `whereYouFoundUs` → "¿Cómo conociste FurMeets?", `interests` → `legacy.interests`, marca `legacy: true`, `species` a texto libre, descarta `avatarUrl`. Renombra la colección original sin borrarla.

**Acceptance criteria:**
- [ ] Correrlo dos veces no duplica nada
- [ ] Mismo conteo de mensajes y votos antes y después
- [ ] Ensayado en staging con una copia de producción
- [ ] Ejecución en producción solo con respaldo y aprobación humana

**Verification:**
- [ ] Unitarias de las transformaciones y de la idempotencia
- [ ] Reporte de conteos del ensayo en staging (criterio de éxito 14)

**Dependencies:** T10, T11

**Files likely touched:**
- `scripts/migrations/001-request-chat-split.ts` (+ `.spec.ts`)
- `package.json` (script `migrate`)

**Estimated scope:** M

---

## Task 40: Listado liviano de solicitudes

**Repo:** API · **RNF:** REN-04, REN-07

**Description:** Hoy `GET /request-chats` carga todas las solicitudes con todos sus mensajes y 4 `populate`, aunque la lista solo usa el último mensaje y los no leídos. Devolver el resumen con una agregación sobre la colección de mensajes (último mensaje, conteo de no leídos del usuario, conteo de votos a favor y en contra), paginado y sin cargar mensajes completos.

**Acceptance criteria:**
- [ ] La respuesta no contiene arreglos de mensajes ni de leídos
- [ ] El tiempo de respuesta no crece con la cantidad total de mensajes (medido con datos de prueba de 50 solicitudes × 200 mensajes)
- [ ] Solo expone conteos de votos en contra, nunca identidades (RNF-PRI-01)

**Verification:**
- [ ] e2e sobre la forma de la respuesta; medición con el script de T37

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
- [ ] El ack y el emit no esperan ninguna llamada a Telegram (verificado con Telegram simulado que tarda 2 s)
- [ ] Si Telegram falla, el mensaje o voto queda guardado y emitido, y el error se registra
- [ ] Enviar y votar hacen como máximo 2 operaciones de Mongo en el camino crítico

**Verification:**
- [ ] Unitarias del servicio con Telegram simulado lento y con error
- [ ] Script de T37: p95 de enviar y votar < 500 ms en staging

**Dependencies:** T11

**Files likely touched:**
- `src/chat/application/chat.service.ts`
- `src/chat/presentation/chat.gateway.ts`
- `src/telegram-bridge/application/telegram-queue.ts` (+ `.spec.ts`)

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
- [ ] Recibir un mensaje o voto no genera ninguna petición HTTP
- [ ] Navegar entre inicio y chat no abre conexiones de socket nuevas
- [ ] El mensaje y el voto propios se ven antes de la respuesta del servidor (probado con red lenta simulada)

**Verification:**
- [ ] Manual en staging con DevTools (Network y throttling "Slow 3G") y dos cuentas

**Dependencies:** T06, T40, T41

**Files likely touched:**
- `src/services/socket.ts` (nuevo)
- `src/services/request-chat.service.ts`
- `src/pages/IndexPage/IndexPage.tsx`
- `src/pages/RequestChatPage/RequestChatPage.tsx`

**Estimated scope:** M

### Checkpoint B: Fase 0 completa
- [ ] Criterios de éxito 1–5 y 14
- [ ] Script de T37 corrido de nuevo y comparado con la línea base; RNF-REN-06, REN-07 y REN-08 cumplidos
- [ ] Revisión humana; despliegue de API y App juntas a staging y luego a producción

---

## Fase 1 — v1 funcional

## Task 13: Formulario de solicitud (API)

**Repo:** API · **RNF:** SEG-02, SEG-05

**Description:** Entidad `ApplicationForm` y `POST /applications` con los campos de SPEC §3.1. Solo edad (entero > 0), ciudad y aceptar reglas son obligatorios. Etiqueta "Menor de edad" si edad < 18. Una solicitud por usuario, sin importar su estado. No editable. El solicitante es el usuario autenticado.

**Acceptance criteria:**
- [ ] Segunda solicitud del mismo usuario → 409
- [ ] Payload sin edad, ciudad o sin aceptar reglas → 400; `requesterUUID` en el body se ignora
- [ ] No existe endpoint de edición; un miembro no puede crear solicitud (403)

**Verification:**
- [ ] Unitarias de la entidad (menor, unicidad, no editable)
- [ ] e2e de creación

**Dependencies:** T06, T10

**Files likely touched:**
- `src/applications/domain/application-form.ts` (+ `.spec.ts`)
- `src/applications/presentation/dtos/create-application.dto.ts`
- `src/applications/presentation/applications.controller.ts`
- `src/chat/domain/entities/request-chat.entity.ts`

**Estimated scope:** M

---

## Task 14: Imágenes del formulario

**Repo:** API · **RNF:** SEG-05

**Description:** El formulario acepta 0–3 imágenes JPEG/PNG/WebP de ≤ 10 MB, subidas por `media`.

**Acceptance criteria:**
- [ ] 4 imágenes → 400; MIME no permitido → 400; > 10 MB → 413
- [ ] Las imágenes se ven en el resumen vía `/media/:id`

**Verification:**
- [ ] Unitarias de la regla de máximo 3; e2e de subida (criterio de éxito 11)

**Dependencies:** T08, T13

**Files likely touched:**
- `src/applications/presentation/applications.controller.ts`
- `src/applications/domain/application-form.ts`
- `src/media/application/media.service.ts`

**Estimated scope:** S

---

## Task 15: App: pantalla Formulario (paso 1 de 3)

**Repo:** App · **RNF:** PRI-04, USA-01, USA-02 · **Deuda:** #13

**Description:** Reescribir `RegisterPage` según el artboard *Formulario*: campos opcionales/obligatorios, hasta 3 imágenes, enlace a reglas desde `VITE_RULES_URL`, aviso de envío definitivo y de que los mensajes se comparten en el grupo. Al enviar, pide `requestWriteAccess` (si lo rechaza, continúa).

**Acceptance criteria:**
- [ ] El botón de enviar se bloquea sin edad, ciudad o sin aceptar reglas
- [ ] No aparece el texto "puedes editarlo hasta que empiecen a revisarte"
- [ ] Tras enviar, navega al chat del solicitante

**Verification:**
- [ ] Manual en staging (móvil y escritorio, tema claro y oscuro)

**Dependencies:** T07, T14

**Files likely touched:**
- `src/pages/RegisterPage/RegisterPage.tsx`
- `src/services/request-chat.service.ts`
- `src/models/request-chat.model.ts`

**Estimated scope:** M

---

## Task 16: Chat: texto con idempotencia y recuperación

**Repo:** API · **RNF:** CON-02, CON-03, REN-01

**Description:** Evento de envío con `clientMessageId`; ack con el mensaje persistido; reenvíos con el mismo id no duplican. Endpoint/evento para recuperar mensajes posteriores a un id o fecha. Emisión a `request-chat:<id>` y resumen a `members`. Se construye sobre el orden persistir → emitir → notificar de T41.

**Acceptance criteria:**
- [ ] Reenviar el mismo `clientMessageId` devuelve el mismo mensaje sin duplicar
- [ ] Tras reconectar, el cliente obtiene los mensajes que se perdió
- [ ] Longitud de texto validada

**Verification:**
- [ ] e2e de idempotencia y reconexión

**Dependencies:** T06, T11, T41

**Files likely touched:**
- `src/chat/presentation/chat.gateway.ts`
- `src/chat/application/chat.service.ts`
- `src/chat/presentation/dtos/create-request-chat-message.dto.ts`
- índice único `requestChatId + clientMessageId` en el schema

**Estimated scope:** M

---

## Task 17: Chat: imágenes y respuestas

**Repo:** API · **RNF:** SEG-05

**Description:** Mensajes con imágenes (sin límite de cantidad, ≤ 10 MB c/u) vía `media`, y `replyToId` para citar un mensaje de la misma solicitud.

**Acceptance criteria:**
- [ ] Un `replyToId` de otra solicitud → 400
- [ ] El mensaje devuelto incluye la cita (autor y extracto)

**Verification:**
- [ ] e2e de imagen y de respuesta

**Dependencies:** T08, T16

**Files likely touched:**
- `src/chat/domain/entities/request-chat-message.entity.ts`
- `src/chat/mappers/request-chat-message.mapper.ts`
- `src/chat/presentation/dtos/create-request-chat-message.dto.ts`

**Estimated scope:** S

---

## Task 18: Chat: leídos y no leídos

**Repo:** API · **RNF:** REN-04

**Description:** Marcado explícito de leídos (`readBy` con usuario y fecha) con operación atómica y evento de actualización a la sala, que también actualiza el contador de no leídos del listado de T40. Historial de mensajes de un chat paginado. (El resumen del listado se hace en T40.)

**Acceptance criteria:**
- [ ] Marcar leído dos veces no duplica la entrada
- [ ] Al marcar leído, el contador de no leídos del listado baja sin recargarlo
- [ ] El solicitante también ve quién leyó sus mensajes; el historial se pide por páginas

**Verification:**
- [ ] e2e de leídos y de paginación del historial

**Dependencies:** T16, T40

**Files likely touched:**
- `src/chat/application/chat.service.ts`
- `src/chat/infraestructure/repositories/chat-mongo.repository.ts`
- `src/chat/presentation/chat.gateway.ts`

**Estimated scope:** M

---

## Task 19: Chat: mensajes de sistema y solo lectura

**Repo:** API

**Description:** Mensajes de sistema (bienvenida, "X entró al chat de revisión", resultado). Tras el cierre, cualquier envío se rechaza.

**Acceptance criteria:**
- [ ] Enviar a una solicitud cerrada → error `RequestChatClosed`
- [ ] Los mensajes de sistema se distinguen por tipo en el DTO

**Verification:**
- [ ] Unitarias de la entidad; e2e de envío a solicitud cerrada

**Dependencies:** T16

**Files likely touched:**
- `src/chat/domain/entities/request-chat.entity.ts`
- `src/chat/domain/entities/request-chat-message.entity.ts`
- `src/chat/application/chat.service.ts`

**Estimated scope:** S

---

## Task 20: App: chat del solicitante y chat de miembros

**Repo:** App · **RNF:** REN-01, CAL-04, USA-01, USA-02

**Description:** Chat con texto, imágenes (adjuntar), responder, "Leído por N" con lista, mensajes de sistema, estado de solo lectura, envío con `clientMessageId` y recuperación al reconectar. Fechas formateadas en el cliente. Sin botones de emoji ni micrófono.

**Acceptance criteria:**
- [ ] Un mensaje enviado aparece en otro cliente conectado sin recargar
- [ ] Al cortar y restablecer la red, no se pierden ni duplican mensajes
- [ ] Chat cerrado: sin caja de texto

**Verification:**
- [ ] Manual en staging con dos cuentas

**Dependencies:** T07, T09, T17, T18, T19

**Files likely touched:**
- `src/pages/RequestChatPage/RequestChatPage.tsx`
- `src/components/ChatBubble/ChatBubble.tsx`
- `src/state/request-chat.slice.ts`
- `src/services/request-chat.service.ts`

**Estimated scope:** M

### Checkpoint C: solicitud y chat
- [ ] Flujo formulario → chat en staging
- [ ] Criterio de éxito 11

---

## Task 21: Revisión: votos y umbrales

**Repo:** API · **RNF:** SEG-04, PRI-01, PRI-02, CON-07 · **Deuda:** #11

**Description:** Votar (`approve | reject`), cambiar y retirar mientras está en curso. Umbrales `APPROVE_THRESHOLD`/`REJECT_THRESHOLD`; el voto que alcanza uno cierra en el acto (actualización condicional para evitar doble cierre). Las respuestas incluyen nombres solo de votos a favor, conteos y el voto propio. Nunca la identidad de quien rechaza.

**Acceptance criteria:**
- [ ] Solicitante votando → 403; `vote` inválido → 400
- [ ] Al alcanzar el umbral, la solicitud pasa a *Approved*/*Rejected* una sola vez
- [ ] Ningún DTO, evento ni log contiene el id de quien votó en contra

**Verification:**
- [ ] Unitarias de dominio (umbrales, cambio, retiro, no votar la propia)
- [ ] Prueba que serializa todas las salidas y busca el id del votante en contra (criterio de éxito 10)

**Dependencies:** T11, T06

**Files likely touched:**
- `src/review/domain/vote.ts` (+ `.spec.ts`)
- `src/chat/domain/entities/request-chat.entity.ts`
- `src/chat/mappers/request-chat.mapper.ts`
- `src/chat/presentation/request-chat.controller.ts`

**Estimated scope:** M

---

## Task 22: Revisión: avales y comentarios privados

**Repo:** API · **RNF:** PRI-01, PRI-03

**Description:** "Lo conozco" (aval informativo, cualquier miembro) y comentarios privados anónimos entre miembros. El autor del comentario se guarda pero solo se expone como `isMine` al propio autor. El solicitante no ve ninguno de los dos mientras no sea miembro.

**Acceptance criteria:**
- [ ] Solicitante pidiendo avales o comentarios → 403
- [ ] Los comentarios no traen autor, solo `isMine`
- [ ] Avalar dos veces no duplica

**Verification:**
- [ ] Unitarias; e2e por rol (criterio de éxito 9)

**Dependencies:** T21

**Files likely touched:**
- `src/review/domain/endorsement.ts`, `private-comment.ts`
- `src/review/presentation/review.controller.ts`
- `src/review/infraestructure/schemas/*.ts`

**Estimated scope:** M

---

## Task 23: App: inicio de miembros

**Repo:** App · **RNF:** PRI-02, REN-04, USA-01

**Description:** Solicitudes en curso con no leídos y etiqueta "Falta tu voto", estadísticas (total, aceptadas, no aprobadas) e historial paginado. Actualización en vivo por la sala `members`.

**Acceptance criteria:**
- [ ] Un mensaje nuevo incrementa el contador sin recargar
- [ ] No se lista quién falta por votar

**Verification:**
- [ ] Manual en staging

**Dependencies:** T18, T21

**Files likely touched:**
- `src/pages/IndexPage/IndexPage.tsx`
- `src/components/RequestChatList/RequestChatList.tsx`
- `src/services/request-chat.service.ts`

**Estimated scope:** M

---

## Task 24: App: votación y resumen del solicitante

**Repo:** App · **RNF:** PRI-01, USA-01

**Description:** Votación plegada con barra de quórum hacia los umbrales fijos (sin estado *Vencida*), avatares solo de quienes aprobaron, texto "Tu voto a favor es visible para el grupo; en contra es anónimo". Resumen con fursona, datos, respuestas, avales, comentarios y leyenda de solicitud migrada.

**Acceptance criteria:**
- [ ] El solicitante no ve el panel de votación
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
- [ ] Revisión humana de privacidad

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

**Description:** *Aprobado* (paso 3 de 3) con el enlace; *No aprobado* sin prometer reintento.

**Acceptance criteria:**
- [ ] El enlace abre la solicitud de unión en Telegram
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
- `src/telegram-bridge/application/telegram-queue.ts`
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

**Repo:** API · **RNF:** CON-04, PRI-01, OBS-01 · **Deuda:** #7

**Description:** DM al solicitante cuando escribe un miembro (si hay permiso). Anuncio en el grupo y DM al cerrar una solicitud. `/faq` responde un placeholder. Ningún mensaje del bot menciona a quien votó en contra.

**Acceptance criteria:**
- [ ] Sin permiso de DM, el mensaje se entrega por socket igual (criterio de éxito 8)
- [ ] El anuncio de resultado solo muestra conteos de rechazos

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

### Checkpoint F: completo
- [ ] Los 15 criterios de éxito de SPEC §13
- [ ] Todos los RNF de [plan.md](plan.md) verificados
- [ ] Revisión humana y merge a `main`
