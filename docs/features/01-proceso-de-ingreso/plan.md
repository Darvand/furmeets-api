# Plan de implementación: Funcionalidad 01 — Proceso de ingreso

> Fuente: [SPEC.md](../../../SPEC.md) (§1–§15). Tareas detalladas: [todo.md](todo.md).
> Repos: **API** = `furmeets-api` · **App** = `furmeets-mini-app`.
> Estado: **Fase 0 en producción** desde el 2026-10-03, junto con T13 y T12 · Fase 1 en curso · Plan creado el 2026-09-29

## Resumen

Reemplazar el ingreso libre al grupo FurMeets por un proceso de admisión controlado por los miembros, dentro de Telegram (bot + MiniApp). El solicitante llena un formulario, conversa con los miembros en un chat propio que se republica en el grupo, los miembros votan (a favor nominal, en contra anónimo) y, al llegar al umbral, el bot le entrega un enlace de solicitud de unión que solo acepta al aprobado.

Hoy existe una versión parcial (chat de solicitudes, votos, enlace con `member_limit: 1`) con problemas graves de seguridad y pérdida de datos (SPEC §14), y con una **lentitud notable en cada interacción, incluso con el servidor despierto**. Por eso el plan empieza por la Fase 0, que endurece lo existente y baja su latencia antes de agregar funcionalidad. El arranque en frío de Render se resuelve en la Fase 2 (T30, T31).

### Causas de la lentitud actual (servidor despierto)

Revisión del código del 2026-09-30, de mayor a menor impacto:

| # | Causa | Dónde | Tarea |
|---|---|---|---|
| 1 | El arranque espera ~9 llamadas a Telegram en serie + ~6 a Mongo, sin caché | `App.tsx:37` → `POST /groups/sync`, `group-adapter.repository.ts`, `user-mongo.repository.ts`, `user.service.ts` | T39, T07 |
| 2 | La App encadena 6 peticiones en serie al arrancar, con `refetch()` duplicados | `App.tsx:37-40`, `IndexPage.tsx:59-61, 78-84` | T07 |
| 3 | `GET /request-chats` carga todas las solicitudes con todos sus mensajes y 4 `populate`, sin `lean()` | `chat-mongo.repository.ts:45-55` | T40 |
| 4 | Cada evento de socket (global) hace que todos los clientes recarguen la lista completa | `chat.gateway.ts:36-44`, `IndexPage.tsx:37-47` | T06, T42 |
| 5 | Abrir un chat reescribe el documento completo | `chat.service.ts:51-52` | T11 |
| 6 | Enviar un mensaje espera ~5 operaciones de Mongo + Telegram antes de emitir; sin UI optimista | `chat.service.ts:56-76`, `RequestChatPage.tsx:68-77` | T41, T42 |
| 7 | Votar espera ~5 llamadas a Telegram en serie; sin voto optimista | `chat.service.ts:84-110` | T41, T42 |
| 8 | Sin índices en Mongo; doble búsqueda del usuario en `GET /users/:telegramId` | `*/schemas/*.ts`, `users.controller.ts` | T38 |
| 9 | El socket se recrea en cada página | `IndexPage.tsx:34`, `RequestChatPage.tsx:45` | T42 |
| 10 | Avatares de 640 px; bundle de ~1 MB sin code splitting, con TonConnect sin uso | `telegram-bot.service.ts:63`, `Root.tsx:27` | T39, T43 |

## Decisiones de arquitectura

- **Autenticación por `initData`** (HMAC-SHA256) en HTTP y socket. Se elimina `x-telegram-id`. El usuario siempre sale del token, nunca del body ni del payload.
- **Rol resuelto en vivo contra Telegram** (`getChatMember`) con caché en memoria de TTL 10 min invalidada por eventos (updates `chat_member` y aprobación del ingreso), no desde `group.members` en BD.
- **Validación de DTOs con `class-validator` + `class-transformer`** y `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`). Joi solo valida la configuración.
- **Autorización en el backend.** La App solo refleja el rol de `GET /me`.
- **Mensajes en su propia colección** con inserciones atómicas; votos y avales con `$set`/`$push`/`$pull` filtrados. Nada reescribe el agregado completo.
- **Imágenes en Telegram** (canal privado de almacenamiento) servidas por el proxy `GET /media/:id`. Costo $0.
- **Admisión por `creates_join_request`**: el bot aprueba solo al usuario aprobado y rechaza a cualquier otro.
- **Persistir → emitir → notificar.** Las llamadas a Telegram van fuera del camino crítico. Ninguna petición del usuario espera la sincronización de fotos, grupo o bot.
- **La App se actualiza en vivo sin recargas:** un solo socket compartido cuyos eventos parchean la caché de RTK Query; envío de mensajes y votos optimistas.
- **Medir antes de optimizar:** línea base de latencia (T37) y comparación al cerrar la Fase 0.
- **Salas de socket por solicitud** (`request-chat:<id>`) más la sala `members`. Sin broadcast global.
- **Módulos nuevos** según el mapa de capacidades (SPEC §2): `auth`, `membership`, `media`, `applications`, `request-chat`, `review`, `admission`, `telegram-bridge`, `platform`. Los módulos actuales (`chat`, `members`, `telegram-bot`) se van partiendo en ellos a medida que se tocan, no en un refactor aparte.
- **DDD pragmático** ([ADR-001](../../decisions/ADR-001-ddd-pragmatico.md)): reglas de negocio en entidades sin E/S, escrituras atómicas y solo si algo cambió, lecturas de pantalla con `lean()` y proyección sin pasar por el dominio, agregados pequeños.
- **Webhook + keep-alive condicional** en Render free.

## Grafo de dependencias

```
T37 línea base de latencia · T38 índices · T43 App: bundle      (sin dependencias)
T01 Revocar token ─────────────────────────────────────────────┐
T02 Pruebas + validación                                        │
  └─ T03 auth HTTP ─┬─ T04 auth socket                          │
                    ├─ T39 Telegram fuera del arranque          │
                    │     └─ T05 membership + GET /me           │
                    │           └─ T06 autorización + salas     │
                    │                 └─ T07 App: auth + rol ───┤
                    └─ T08 media (proxy + almacenamiento)       │
                          └─ T09 App: sin token ◄───────────────┘
T10 colección de mensajes ─ T11 operaciones atómicas ─ T12 migración (después de T13)
        ├─ T40 listado liviano ─────────────┐
        ├─ T41 enviar/votar sin Telegram ───┴─ T42 App: en vivo y optimista (+T06)
        │
        ├─ T13 formulario API ─ T14 imágenes form ─ T15 App: formulario
        ├─ T16 chat texto/ack ─ T17 imágenes ─ T18 historial paginado ─ T19 sin bot/solo lectura
        │                                                   └─ T20 App: chats
        ├─ T45 equals ─ T21 votos ─ T22 avales/comentarios ─ T23 inicio (API + App) ─ T24 App: votación y resumen
        ├─ T25 admisión ─ T26 App: aprobado/no aprobado
        └─ T27 anuncios/republicación ─ T28 replies desde grupo ─ T29 DMs y resultados
T30 webhook ─ T31 keep-alive · T32 CORS/env · T33 Dockerfile · T34 ambientes · T35 rendimiento · T36 limpieza App · T44 App: carga
```

## Estado del release (2026-10-03)

La Fase 0 está en producción, junto con el formulario de la API (T13) y la migración de datos (T12). API: PR #23 (`development` → `main`); App: PR #11.

- **Migración 001 en producción.**
  - 83 solicitudes; 1647 mensajes pasados a `requestchatmessages`; 431 votos; 121 `avatarUrl` quitados.
  - Verificación: mensajes 1647/1647 y votos 431/431, OK.
  - Índices creados al arrancar (`users.telegramId` y `requestchats.requester` únicos); las búsquedas de T38 usan `EXPRESS_IXSCAN`.
  - En la Mini App de producción, las solicitudes se abren con sus mensajes y la App va rápida.
- **Bundle de producción de la App:** sin `api.telegram.org`, `VITE_TELEGRAM_BOT_TOKEN` ni tokens de bot (build de `main`, criterio de éxito 3).
- **Latencia en staging** (script de T37, n=20, p50 desde el cliente): el arranque bajó de ~55 s a 783 ms, enviar de 948 a 297 ms y votar de 620 a 275 ms. Estimado en la API: enviar ~150 ms y votar ~140 ms.
- **T01:** token del bot revocado y rotado en staging y en producción (confirmado el 2026-10-03).

**Pendiente del release:**
- [ ] **REN-07:** enviar y votar cumplen p95 < 500 ms (medición del 2026-10-03, ver T37 en todo.md). Abrir chat quedaba en ~500 ms porque traía todo el historial; con T18 trae solo los últimos 50 (falta medirlo de nuevo). Para el dato exacto, revisar las líneas `Timing` en los logs de Render.
- [ ] **REN-06 / T42:** prueba manual con dos cuentas y la red en "Slow 3G".
- [x] **Índice viejo de mensajes (T18):** `requestChatId_1_createdAt_1` borrado en staging y producción (2026-10-05), después de crear el nuevo.
- [ ] **Migración 002 (T19):** quitar del chat los mensajes del bot (`npm run migrate:002`, ver T19 en todo.md). Hecha en staging el 2026-10-05 (8 mensajes, respaldados); falta producción después del release.
- [ ] **Copia de la migración:** borrar `requestchats_pre_001` en producción y en staging cuando ya no haga falta (se conserva por ahora, decisión del 2026-10-03).

## Lista de tareas

### Fase 0 — Seguridad, datos y latencia (bloquea todo lo demás)

Los IDs se mantienen estables; T37–T43 son las tareas de latencia, insertadas en el orden de ejecución. T37, T38 y T43 no dependen de nada y pueden hacerse de inmediato.

- [x] T01: Revocar el token del bot y rotar secretos
- [x] T37: Línea base de latencia
- [x] T38: Índices y lecturas livianas
- [x] T02: Infraestructura de pruebas y validación
- [x] T03: Autenticación HTTP por `initData`
- [x] T04: Autenticación del socket por `initData`
- [x] T39: Telegram fuera del camino crítico al arrancar
- [x] T05: Rol en vivo (`membership`) y `GET /me`
- [x] T06: Autorización por rol y salas por solicitud

#### Checkpoint A: Autenticación
- [x] Criterios de éxito 1, 2 y 4 (SPEC §13) cubiertos por pruebas e2e
- [x] Revisión humana antes de seguir (PRs revisados y mergeados; T01 hecho)

- [x] T07: App autenticada y enrutada por rol
- [x] T43: App: bundle más liviano
- [x] T08: Módulo `media`: canal de almacenamiento y proxy `/media/:id`
- [x] T09: App sin token del bot
- [x] T10: Mensajes en su propia colección
- [x] T11: Operaciones atómicas y lecturas sin efectos
- [x] T12: Migración de datos existentes
- [x] T40: Listado liviano de solicitudes
- [x] T41: Enviar y votar sin esperar a Telegram
- [x] T42: App en vivo sin recargas y con UI optimista

#### Checkpoint B: Fase 0 completa
- [x] Criterios de éxito 1–5 y 14
- [x] Bundle de la App sin token (criterio 3)
- [x] Migración ensayada en staging
- [ ] Latencia medida de nuevo con el script de T37 y comparada con la línea base; RNF-REN-06, REN-07 y REN-08 cumplidos. Enviar y votar cumplen; abrir chat queda en el límite (T18). Falta la prueba manual con red lenta (REN-06).
- [x] Revisión humana; despliegue a producción de la Fase 0 (2026-10-03)

### Fase 1 — v1 funcional
- [x] T13: Formulario de solicitud (API)
- [x] T14: Imágenes del formulario
- [x] T15: App: pantalla Formulario (paso 1 de 3) — falta la prueba manual en staging
- [x] T16: Chat: texto con idempotencia y recuperación
- [x] T17: Chat: imágenes (las respuestas se quitaron el 2026-10-04)
- [x] T18: Chat: historial paginado — falta la prueba manual de la App en staging
- [x] T19: Chat: sin mensajes del bot y solo lectura (cambio de alcance del 2026-10-05) — falta correr la migración 002 y la prueba manual de la App
- [x] T20: App: chat del solicitante y chat de miembros — falta la prueba manual en staging con dos cuentas

#### Checkpoint C: Solicitud y chat
- [ ] Flujo solicitante: formulario → chat, en staging
- [x] Criterio de éxito 11: `test/applications.e2e-spec.ts` (4 imágenes → 400 sin crear la solicitud; `PUT` y `PATCH` a `/applications` → 404; una segunda solicitud → 409)

- [x] T45: Corregir `ValueObject.equals`
- [ ] T21: Revisión: votos y umbrales
- [ ] T22: Revisión: avales y comentarios
- [ ] T23: App: inicio de miembros
- [ ] T24: App: votación y resumen del solicitante

#### Checkpoint D: Revisión
- [ ] Criterios de éxito 9 y 10
- [ ] Revisión humana: el solicitante no recibe votos, avales ni comentarios mientras no sea miembro

- [ ] T25: Admisión por solicitud de unión
- [ ] T26: App: pantallas Aprobado y No aprobado
- [ ] T27: Puente: anuncios y republicación en el grupo
- [ ] T28: Puente: respuestas desde el grupo
- [ ] T29: Puente: DMs, resultados y `/faq`

#### Checkpoint E: v1 funcional
- [ ] Criterios de éxito 6, 7 y 8
- [ ] Flujo completo en staging con bot y grupo de prueba

### Fase 2 — Rendimiento e infraestructura
- [ ] T30: Webhook con `secret_token`
- [ ] T31: Keep-alive condicional
- [ ] T32: CORS restringido y validación de configuración
- [ ] T33: Dockerfile multi-etapa y versión de Node
- [ ] T34: Ambientes staging/producción aislados
- [ ] T35: Verificación de rendimiento
- [ ] T36: Limpieza de la App
- [ ] T44: App: pantalla de carga durante el arranque en frío

#### Checkpoint F: Completo
- [ ] Los 15 criterios de éxito (SPEC §13)
- [ ] Todos los RNF de abajo verificados
- [ ] Listo para merge a `main`

## Requerimientos no funcionales

Necesarios para dar la funcionalidad por terminada. Cada uno indica cómo se verifica y qué tareas lo cubren.

### Seguridad (bloquean el lanzamiento)

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-SEG-01 | Toda petición HTTP y conexión de socket se autentica con `initData` válido (HMAC-SHA256, `auth_date` < 24 h). Sin él: 401 / conexión rechazada. | Unitarias del validador; e2e de endpoints y handshake | T03, T04 |
| RNF-SEG-02 | La identidad del usuario sale solo del `initData`. Ningún `userUUID`, `requesterUUID` ni autor viaja desde el cliente. | e2e: un id falso en body/payload se ignora | T03, T04, T13, T16 |
| RNF-SEG-03 | El token del bot nunca llega al cliente: ni `VITE_TELEGRAM_BOT_TOKEN` ni URLs `api.telegram.org/file/bot…` en el bundle. | `grep` sobre el build de producción | T01, T09 |
| RNF-SEG-04 | Autorización por rol en cada endpoint y evento: el solicitante solo accede a lo suyo; solo miembros votan, avalan y comentan. | e2e: 403 en cada caso cruzado | T06, T21, T22 |
| RNF-SEG-05 | Validación de entrada en todos los DTOs con `class-validator` (tipos, longitudes, enums, MIME y tamaño de imagen); campos no declarados se rechazan. | Unitarias/e2e con payloads inválidos → 400 | T02, T13, T14, T16, T17, T21 |
| RNF-SEG-06 | CORS restringido a los orígenes de la App de cada ambiente; sin `*` con credenciales. | e2e: origen no permitido rechazado | T32 |
| RNF-SEG-07 | Webhook protegido con `X-Telegram-Bot-Api-Secret-Token`. | e2e: sin secreto → 401 | T30 |
| RNF-SEG-08 | Secretos solo en variables de entorno del servidor; nunca en `VITE_*` ni en el repo. | Revisión del diff; `.env` en `.gitignore` | T01, T32 |
| RNF-SEG-09 | Los enlaces de admisión solo admiten al usuario aprobado; cualquier otra cuenta es rechazada. | e2e con el bot simulado | T25 |
| RNF-SEG-10 | Un cambio de membresía (expulsión, salida, ingreso) se refleja en la siguiente petición del usuario, sin esperar a que venza la caché de 10 min. | e2e: expulsado → 403 en la siguiente petición | T05, T25, T30 |

### Privacidad

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-PRI-01 | Votos (a favor y en contra), avales y comentarios llevan el nombre de su autor y los ven todos los miembros (decidido el 2026-10-03; reemplaza el anonimato). | e2e por rol sobre la forma de las respuestas | T21, T22, T24 |
| RNF-PRI-02 | No se listan por nombre los miembros que faltan por votar. Solo la etiqueta personal "Falta tu voto". | e2e sobre la respuesta del listado | T21, T23 |
| RNF-PRI-03 | Formulario, votos, avales y comentarios solo visibles para miembros; el solicitante ve su formulario y su chat. Nada de la revisión viaja en las respuestas ni en los eventos de socket que recibe el solicitante (incluido `request-chat-update`, que va a la sala de su solicitud). | e2e por rol; prueba que serializa las salidas al solicitante (criterio de éxito 10) | T06, T21, T22 |
| ~~RNF-PRI-04~~ | ~~El formulario advierte que los mensajes se comparten en el grupo y que el envío es definitivo.~~ Retirado el 2026-10-04: el formulario no muestra esos avisos. | — | — |
| RNF-PRI-05 | Retención indefinida: no se borran solicitudes, mensajes ni imágenes. La migración conserva la colección original. | Revisión del script de migración | T12 |

### Rendimiento

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-REN-01 | Entrega de un mensaje a los demás clientes conectados: p95 < 1 s (servidor despierto). | Script de medición en staging | T16, T35 |
| RNF-REN-02 | Carga inicial de la App hasta contenido útil < 2 s (servidor despierto). | Medición con DevTools en staging | T05, T07, T39, T43, T35 |
| RNF-REN-03 | Arranque en una sola petición (`GET /me`); sincronización con Telegram en paralelo, en segundo plano y cacheada (TTL 10 min). | Unitarias de la caché; conteo de peticiones | T05, T07, T39 |
| RNF-REN-04 | El listado devuelve resumen (último mensaje, conteos de votos) sin cargar todos los mensajes; historial paginado. | e2e sobre la forma de la respuesta | T40, T18, T23 |
| RNF-REN-05 | API y MongoDB Atlas en la misma región. | Revisión de configuración | T34 |
| RNF-REN-06 | El mensaje propio y el voto propio se ven **al instante** (UI optimista) y se confirman con el ack; si fallan, quedan marcados como "no enviado" con opción de reintento. | Manual en staging con red lenta simulada | T41, T42 |
| RNF-REN-07 | Con el servidor despierto, enviar, votar y abrir un chat responden en **p95 < 500 ms** medido en la API. | Script de T37 antes y después | T38, T40, T41 |
| RNF-REN-08 | Ninguna petición del usuario espera una llamada a Telegram, salvo la validación de membresía con la caché fría. | Unitarias con Telegram simulado lento; logs de duración | T39, T41 |

### Confiabilidad e integridad de datos

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-CON-01 | 0 mensajes perdidos con envíos concurrentes (20 concurrentes → 20 persistidos, en orden, con `createdAt` original). | e2e de concurrencia | T10, T11 |
| RNF-CON-02 | Idempotencia de envíos por `clientMessageId`; ack con el mensaje persistido. | e2e: reenvío no duplica | T16 |
| RNF-CON-03 | Recuperación de mensajes posteriores al último recibido al reconectar. | e2e de reconexión | T16 |
| RNF-CON-04 | Persistir → emitir → notificar. Un fallo de Telegram (DM, republicación) nunca revierte ni oculta un mensaje. | e2e con Telegram simulado que falla | T27, T29 |
| RNF-CON-05 | Las lecturas no escriben. | Unitarias del servicio | T11 |
| RNF-CON-06 | La migración es idempotente, se ensaya en staging, se corre con respaldo y conserva conteos. | Unitarias + conteos antes/después | T12 |
| RNF-CON-07 | El voto que alcanza el umbral cierra la solicitud en el acto, sin carreras que permitan superar el umbral o cerrar dos veces. | Unitarias de dominio + e2e concurrente | T21 |

### Costo y operación

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-OPE-01 | Costo $0: Render free, Atlas M0, Vercel/GitHub Pages, Telegram como almacenamiento. Cualquier opción paga se documenta con precio y se aprueba antes. | Revisión del plan | Todas |
| RNF-OPE-02 | La API de producción no se duerme mientras haya solicitudes en curso; sin solicitudes, deja de hacer ping. | Unitarias del activador + prueba en staging | T31 |
| RNF-OPE-03 | Staging y producción aislados (bot, grupo, BD, API) y desplegados desde `development` y `main`. | Revisión de configuración | T34 |
| RNF-OPE-04 | La imagen de producción compila (build multi-etapa) con una única versión LTS de Node en Docker y CI. | `docker build` | T33 |
| RNF-OPE-05 | La configuración se valida al arrancar (Joi); la app no arranca con variables faltantes. | Unitarias del esquema | T32 |

### Observabilidad

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-OBS-01 | Errores de llamadas a Telegram se registran con contexto (evento, id de solicitud). | Revisión de logs en staging | T27, T29 |
| RNF-OBS-02 | Autenticaciones y autorizaciones rechazadas se registran a nivel `warn`, sin el `initData` completo. | Revisión de logs | T03, T06 |
| RNF-OBS-03 | La duración de cada ruta HTTP y de cada evento de socket queda registrada, para detectar regresiones de latencia. | Revisión de logs | T37 |

### Calidad y mantenibilidad

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-CAL-01 | Cobertura ≥ 80 % en `domain/` y en `auth`. | `npm run test:cov` | T02 y siguientes |
| RNF-CAL-02 | `lint`, `build` y `test` pasan antes de cada commit. | CI / local | Todas |
| RNF-CAL-03 | Dominio puro (sin Nest ni Mongoose); reglas de negocio en entidades; mappers como única frontera. | Revisión de código | Todas las de API |
| RNF-CAL-04 | Fechas en ISO-8601 UTC; el cliente formatea. | Unitarias de mappers | T10, T20 |

### Usabilidad y compatibilidad

| Id | Requerimiento | Verificación | Tareas |
|---|---|---|---|
| RNF-USA-01 | Textos visibles al usuario en español; pantallas según el diseño de referencia con los ajustes de SPEC §3. | Revisión manual | T15, T20, T23, T24, T26, T44 |
| RNF-USA-02 | La App funciona en los clientes de Telegram móvil (Android/iOS) y escritorio, con tema claro y oscuro. | Prueba manual en staging | T15, T20, T23, T24, T26, T44 |

## Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El token actual ya está publicado en el bundle | Alto | T01 va primero, antes de cualquier otra tarea |
| La migración corrompe o pierde datos de producción | Alto | Script idempotente, ensayo en staging con copia, respaldo previo, colección original conservada, aprobación humana |
| Fuga de la revisión al solicitante (p. ej. votos con nombre en `request-chat-update`, que también le llega) | Alto | DTO del solicitante sin votos, avales ni comentarios; prueba que serializa todo lo que recibe y no los encuentra |
| El auto-ping no evita que Render duerma el servicio | Medio | Verificar en staging; alternativa cron-job.org (gratis) |
| Keep-alive se considere abuso en los términos de Render | Medio | Solo con solicitudes en curso; plan B Render Starter (~$7/mes) |
| La UI optimista muestra un mensaje o voto que luego falla | Medio | Estado "no enviado" con reintento; se reconcilia con el ack por `clientMessageId` |
| Con 0.1 CPU de Render las metas de latencia no se alcanzan aun con el código optimizado | Medio | La línea base (T37) separa el tiempo de CPU del de Mongo/Telegram; si el CPU es el cuello de botella, se evalúa la VM Always Free de Oracle ($0) antes que un plan pago |
| Límites de la Bot API (rate limit al republicar o enviar DMs) | Medio | Envíos encolados fuera del camino crítico, con reintento y log |
| Cambiar la autenticación rompe la App desplegada | Medio | Desplegar API y App juntas (T03–T07) en staging y luego en producción |

## Paralelización

- **Secuencial:** T03 → T06 (contrato de autenticación), T10 → T11 → T13 → T12 (esquema, formulario y migración). T12 espera a T13 para migrar el formulario directo a su modelo; no se despliega a producción entre T10 y T12.
- **En paralelo tras T06:** T08 (media) y T10 (mensajes).
- **En paralelo tras definir el contrato de la API:** las tareas de App (T15, T20, T23, T24, T26) contra las de API correspondientes.
- **Independientes:** T32–T34 (`platform`) pueden avanzar en cualquier momento. T37, T38 y T43 (latencia) también, y conviene hacerlas primero porque dan mejoras inmediatas.

## Preguntas abiertas

No hay preguntas abiertas.

### Resueltas

- 2026-10-03: "Contactar a un admin" en la pantalla de carga abre `https://t.me/DarvandFrovonwill` (T44).
- 2026-10-03: nada es anónimo dentro del grupo. Votos, avales y comentarios muestran a su autor a todos los miembros (RNF-PRI-01). Afecta a T21, T22, T24 y T29.
- 2026-10-03: `REJECT_THRESHOLD` pasa a 5, igual que `APPROVE_THRESHOLD`; siguen siendo dos variables (T21).
- 2026-10-03: el formulario no pide pronombres. La API de T13 ya los acepta: se quitan en T14.
- 2026-10-03: sin reglas de convivencia también en *Aprobado* y en la pantalla de carga (T26, T44).

- 2026-09-29: se aprueba `mongodb-memory-server` como dependencia de desarrollo para las pruebas e2e (T02).
- 2026-09-29: los DTOs se validan con `class-validator` + `class-transformer` y un `ValidationPipe` global (T02). Joi queda solo para la configuración (T32).
- 2026-10-03: el formulario no pide aceptar las reglas de convivencia ni enlaza a ellas; se descarta `VITE_RULES_URL`.
- 2026-09-29: la caché de membresía tiene TTL de 10 min y se invalida por eventos: updates `chat_member` del grupo (T05) y aprobación del ingreso (T25).
