# Spec: FurMeets — Admisión al grupo vía Telegram MiniApp

> Documento vivo. Cubre los dos repositorios:
> - **API + bot**: `furmeets-api` (este repo)
> - **MiniApp**: `furmeets-mini-app`
>
> Estado: **borrador pendiente de aprobación** · Última actualización: 2026-10-03
> Diseño de referencia (Claude Design): [Chat de solicitudes — FurMeets MiniApp](https://claude.ai/artifact/2PRhv3UT2bCmUV6A62wvrj) · Design system: [FurMeets](https://claude.ai/artifact/L98bN6XNnbHjMbAbyYtmkK)

---

## 1. Objetivo

FurMeets es una comunidad furry en Telegram que creció y empezó a recibir personas indebidas y bots ajenos. El proyecto reemplaza el ingreso libre por un **proceso de admisión controlado por los propios miembros**, que ocurre **íntegramente dentro de Telegram** (bot + MiniApp).

Cada persona que quiere entrar llena una solicitud y conversa con los miembros en un chat que está **fuera del grupo, pero controlado por el grupo**. Los miembros votan y, al alcanzar el umbral, el bot le da acceso al solicitante aprobado, y **solo a él**.

### Restricción transversal: costo $0

Es un proyecto sin ánimo de lucro. **Toda decisión técnica debe buscar costo cero.** Siempre se presentan primero las opciones gratuitas; si una necesidad no tiene alternativa gratuita viable, se documentan las opciones pagas con su precio.

### Actores

| Actor | Quién es | Qué puede hacer |
|---|---|---|
| **Miembro** | Usuario cuyo estado en el grupo es `creator`, `administrator`, `member` o `restricted` con `is_member=true`. Se verifica contra Telegram, no contra la BD. | Ver todas las solicitudes, conversar en cualquier chat, votar, avalar y comentar. |
| **Solicitante** | Cualquier usuario de Telegram que no es miembro. | Crear **una** solicitud (no editable una vez enviada) y conversar en **su** chat. |
| **Bot** | `@furmeets_bot` (prod) / `@furmeets_test_bot` (staging). | Anunciar, reenviar mensajes, notificar, almacenar imágenes y aprobar o rechazar las solicitudes de unión. |

Los administradores del grupo **no tienen permisos distintos** a los de un miembro. La única operación privilegiada es habilitar una nueva solicitud para un rechazado, y se hace **manualmente en la base de datos**.

### Flujo principal

```
Usuario abre la MiniApp
        │
        ├─ ¿Es miembro? ──sí──► Inicio: solicitudes en curso, estadísticas e historial
        │                          └─► Chat de una solicitud (conversar, votar, avalar, comentar)
        │
        └─ no ─► ¿Tiene solicitud?
                   ├─ no ──► Bienvenida ─► Formulario (paso 1 de 3)
                   ├─ En curso ──► Chat del solicitante (paso 2 de 3)
                   ├─ Aprobada ──► Pantalla de aprobado con su enlace (paso 3 de 3)
                   └─ Rechazada ──► Pantalla de no aprobado
```

1. El solicitante llena el formulario (§3.1) y lo envía. El bot anuncia la solicitud en el grupo.
2. Se abre el chat. Cada mensaje del solicitante se **republica tal cual en el grupo principal** (texto e imágenes). Los miembros responden desde la MiniApp o **respondiendo (reply) al mensaje del bot en el grupo**.
3. Los miembros votan. Al llegar a **N aprobaciones** o **M rechazos**, la solicitud se cierra.
4. **Si se aprueba:** se crea un enlace personal que genera una *solicitud de unión*. El bot solo acepta la unión si viene del usuario aprobado. Cualquier otra persona que use el enlace es rechazada.
5. **Si se rechaza:** el solicitante ve la pantalla de no aprobado. No puede volver a aplicar salvo que alguien lo habilite en la BD.

---

## 2. Mapa de capacidades

Por su tamaño, el proyecto se divide en módulos. Cada uno puede tener después su propio `SPEC-<id>.md`.

| Id del módulo | Responsabilidad | Depende de |
|---|---|---|
| `auth` | Validar el `initData` de Telegram (HMAC) en HTTP y WebSocket e identificar al usuario | — |
| `membership` | Resolver el rol (miembro/solicitante) en vivo contra Telegram, con caché corta | `auth` |
| `media` | Guardar imágenes en Telegram (canal de almacenamiento) y servirlas por proxy autorizado | `auth`, `membership` |
| `applications` | Formulario, ciclo de vida de la solicitud y reglas de edición y unicidad | `membership`, `media` |
| `request-chat` | Mensajería en tiempo real, respuestas e imágenes | `applications`, `media` |
| `review` | Votos, umbrales, avales y comentarios, todos con nombre | `applications` |
| `admission` | Enlace con solicitud de unión, aprobación o rechazo automático de uniones | `review` |
| `telegram-bridge` | Anuncios, republicación en el grupo, respuestas desde el grupo y DMs | `request-chat`, `review`, `admission` |
| `platform` | Ambientes, despliegue, webhook, keep-alive y CI | — |

**Orden de construcción:** Fase 0 (§9) → `auth` → `membership` → `media` → `applications` → `request-chat` → `review` → `admission` → `telegram-bridge`. `platform` avanza en paralelo.

---

## 3. Requisitos funcionales

### 3.1 Formulario de solicitud (`applications`)

Los campos salen del diseño (artboard *Formulario*). **Solo la edad y la ciudad son obligatorias.** Todo lo relativo a la fursona es opcional, porque hay personas que entran sin tenerla definida todavía.

| Sección | Campo | Tipo | Obligatorio |
|---|---|---|---|
| Tu fursona | Fotos o referencias | **0–3 imágenes** (JPEG/PNG/WebP, ≤10 MB c/u) | No |
| | Nombre de la fursona | texto | No |
| | Especie | texto libre (reemplaza el enum `Species`) | No |
| Sobre ti | Edad | entero > 0 | **Sí** |
| | Ciudad | texto | **Sí** |
| | Redes donde subes tu fursona | texto/URLs | No |
| Preguntas | ¿Cómo conociste FurMeets? | texto largo | No |
| | ¿Conoces a alguien del grupo? | texto (@usuario) | No |
| | ¿Has ido a algún meet antes? | texto largo | No |

Reglas:
- **Pronombres no se piden** (decidido el 2026-10-03). El diseño todavía los muestra en el *Resumen*: esa fila se quita.
- **No hay reglas de convivencia** en ninguna pantalla: ni en el formulario, ni en *Aprobado*, ni en *Carga*.
- **Menores de edad pueden aplicar.** Si la edad es menor que 18, la solicitud lleva la etiqueta visible **"Menor de edad"**. No hay otras reglas especiales.
- **Una solicitud por usuario.** Si existe cualquier solicitud previa, sin importar su estado, no se puede crear otra. Rehabilitar a alguien se hace a mano en la BD.
- **El formulario no se puede editar** una vez enviado. El diseño dice "puedes editarlo hasta que empiecen a revisarte": **ese texto se quita**. El formulario no muestra avisos de envío definitivo ni de que los mensajes del chat se comparten en el grupo (decidido el 2026-10-04).
- Al enviar, la MiniApp pide `requestWriteAccess` para que el bot pueda escribirle por privado. Si el usuario lo rechaza, igual puede continuar.
- `requesterUUID` **no** viaja en el body: el solicitante es siempre el usuario autenticado.

### 3.2 Chat de la solicitud (`request-chat`)

Alcance de la v1:
- Mensajes de texto.
- **Imágenes sin límite de cantidad** en el chat (cada una ≤10 MB, que es el límite de subida de Telegram).
- **Responder a un mensaje** (cita al estilo Telegram).
- Mensajes de sistema o del bot: bienvenida, "X entró al chat de revisión" y resultado.
- Tras el cierre (aprobada o rechazada), el chat queda en **solo lectura**.

Fuera de alcance en la v1: notas de voz, stickers y selector de emojis, editar o borrar mensajes, reacciones, leídos y no leídos (ni "Leído por" ni contador). El diseño muestra los botones de emoji y micrófono; en la v1 solo se implementa el de adjuntar. El doble check de los mensajes propios indica que la API guardó el mensaje (ack), no que alguien lo leyó.

Requisitos técnicos:
- Cada solicitud tiene su propia sala de socket (`request-chat:<id>`). **Nunca** se hace un broadcast global. Los miembros además se unen a una sala `members` para recibir las actualizaciones del listado.
- El solicitante solo puede unirse a la sala de **su** solicitud.
- El autor de un mensaje es siempre el usuario autenticado del socket, nunca un campo del payload.
- Cada envío lleva un `clientMessageId` (idempotencia) y recibe un *ack* con el mensaje persistido.
- Al reconectar, el cliente recupera los mensajes posteriores al último que recibió.
- **Primero se persiste y se emite; después se notifica.** Las notificaciones de Telegram nunca bloquean ni rompen la entrega del mensaje.

### 3.3 Revisión (`review`)

- **Nada es anónimo dentro del grupo** (decidido el 2026-10-03; reemplaza los votos en contra y comentarios anónimos). Votos, avales y comentarios llevan el nombre de su autor y los ven todos los miembros.
- **Votos nominales:**
  - Todos los miembros ven quién votó **a favor** y quién votó **en contra**, agrupados por opción ("Aceptar: Zelev07, Nala…" · "Rechazar: Sombra"), además de los conteos.
  - El texto del panel es "tu voto lo ve todo el grupo" (como en el diseño).
  - No se lista a quién le falta votar; cada miembro ve la etiqueta personal "Falta tu voto".
  - El solicitante, al ingresar al grupo, ve su propia revisión como cualquier miembro.
- **El solicitante no ve la revisión mientras no sea miembro:** ni el panel de votación ("Votación · no la ve <solicitante>"), ni los avales, ni los comentarios. Esto se aplica en el backend: nada de eso viaja en las respuestas ni en los eventos de socket que recibe.
- Mientras la solicitud está en curso, un miembro puede **cambiar o retirar** su voto.
- **Umbrales fijos, sin vencimiento:** se aprueba con `APPROVE_THRESHOLD` aprobaciones y se rechaza con `REJECT_THRESHOLD` rechazos; los dos valen **5** (por defecto y en los ambientes). Gana la primera opción que llegue a su umbral, y el voto que lo alcanza cierra la solicitud en el acto.
  - La votación se muestra plegada con dos barras, una por opción, con tantos segmentos como su umbral. No existe el estado *Vencida*.
- El solicitante no puede votar; el backend lo impide.
- **Avales:** cualquier miembro puede marcar "Lo conozco, lo avalo" en el resumen de una solicitud, lo haya nombrado el solicitante o no, y retirarlo. Llevan el nombre de quien avala y son **solo informativos**: no afectan la votación.
- **Comentarios:** notas entre miembros en el resumen de la solicitud ("Comentario para el grupo"). Muestran a su autor y la hora; los ve todo el grupo, no el solicitante.
- Fuera de alcance en la v1: *Reportar solicitud*.

### 3.4 Admisión (`admission`)

- Al aprobarse una solicitud, el bot crea un enlace con `createChatInviteLink({ creates_join_request: true, name: <id de la solicitud> })`.
- El enlace se muestra en la pantalla *Aprobado* de la MiniApp y se envía por DM, si hay permiso.
- **El enlace no caduca**: sigue válido hasta que el aprobado lo use. Tras su ingreso se revoca.
- Cuando llega un `chat_join_request`:
  - Si viene de un usuario con solicitud **aprobada**, se hace `approveChatJoinRequest`, se marca la solicitud como *ingresó* y se revoca el enlace.
  - En cualquier otro caso, se hace `declineChatJoinRequest`.
- Requisitos operativos: el bot es administrador con el permiso de invitar usuarios, y los administradores deshabilitan cualquier otro enlace público del grupo.

### 3.5 Puente con Telegram (`telegram-bridge`)

| Evento | Acción del bot |
|---|---|
| Nueva solicitud | Anuncio en el grupo principal con un resumen y un deep link a la MiniApp |
| Mensaje del solicitante | **Republicación textual en el grupo principal** (texto e imágenes, reutilizando el `file_id`), con el encabezado "Nombre · solicitud". Se guarda el `message_id` del grupo |
| *Reply* de un miembro al mensaje republicado | Si el autor es miembro, se crea un mensaje en el chat de la solicitud a su nombre. Si no lo es, se ignora |
| Mensaje de un miembro | DM al solicitante con un enlace al chat (si hay permiso de escritura) |
| Solicitud aprobada o rechazada | Anuncio en el grupo y DM al solicitante |
| Comando `/faq` | Responde las preguntas frecuentes (hoy es un placeholder) |

- El modo privacidad del bot puede quedarse **activado**: Telegram le entrega igual las respuestas a sus propios mensajes.
- Todas las llamadas a Telegram se hacen fuera del camino crítico (encoladas o *fire-and-forget* con log de error). Un fallo en un DM nunca revierte ni oculta un mensaje.

### 3.6 Pantallas (MiniApp)

Las pantallas siguen el diseño de referencia:
- **Carga.** Mientras la API no responde (arranque en frío de Render): una barra cuenta hasta 60 s y rotan mensajes cada 6 s. Pasados los 60 s, muestra "Esto está tardando más de lo normal" con *Reintentar* y el enlace "Contactar a un admin" (`https://t.me/DarvandFrovonwill`). En cuanto la API responde, la app salta a su pantalla sin esperar a la barra.
- **Bienvenida** (antes del formulario): presenta FurMeets, explica los 3 pasos y lleva al formulario con "Quiero unirme".
- **Formulario** (paso 1 de 3).
- **Chat del solicitante** (paso 2 de 3), sin votación.
- **Aprobado** (paso 3 de 3), con el enlace. **Se ajusta:** no enlaza a reglas de convivencia; solo invita a presentarse en el chat al entrar.
- **No aprobado.** Su texto **se ajusta**: no debe prometer un reintento tras conseguir un aval, porque rehabilitar es manual.
- **Inicio de miembros:** en curso, con la etiqueta "Falta tu voto"; estadísticas de total, aceptadas y no aprobadas; historial.
- **Chat de miembros:** la votación viene plegada con las dos barras de umbral; al abrirla muestra quién votó qué.
- **Resumen del solicitante:** fursona, datos, respuestas, avales, comentarios y votación.

Las **solicitudes migradas** (sin formulario nuevo) muestran en el *Resumen* la leyenda "Solicitud anterior al formulario actual" y sus campos legados (§9.1).

La autorización se decide **en el backend**. El frontend solo refleja el rol que devuelve la API (`GET /me` → `{ user, role, requestChatId?, requestChatState? }`).

---

## 4. Requisitos no funcionales

### 4.1 Seguridad (obligatorio, bloquea el lanzamiento)

1. **Autenticación por `initData`.** Cada petición HTTP envía `Authorization: tma <initDataRaw>` y cada conexión de socket lo envía en `handshake.auth`. La API valida el HMAC-SHA256 (clave `HMAC_SHA256("WebAppData", BOT_TOKEN)`) y que `auth_date` tenga menos de 24 h. Se elimina `x-telegram-id`.
2. **El token del bot nunca llega al cliente.** Se eliminan `VITE_TELEGRAM_BOT_TOKEN` y las URLs `api.telegram.org/file/bot…`. Avatares, foto del grupo e imágenes se sirven por `GET /media/:id`, un proxy de la API con autorización.
3. **Autorización por rol en cada endpoint y evento de socket:**
   - Solicitante: solo su solicitud, sus mensajes y su formulario.
   - Miembro: todo lo demás.
   - Solo miembros votan, avalan y comentan.
4. **Validación de entrada** en todos los DTOs (tipos, longitudes, `vote` ∈ {approve, reject}, tamaño y MIME de las imágenes).
5. **CORS** restringido a los orígenes de la MiniApp de cada ambiente (sin `*` con credenciales).
6. **Webhook** protegido con `secret_token` (header `X-Telegram-Bot-Api-Secret-Token`).

### 4.2 Rendimiento y confiabilidad

Metas con el servidor ya despierto:

| Métrica | Meta |
|---|---|
| Mensaje entregado a los demás clientes conectados | p95 < 1 s |
| Carga inicial de la MiniApp hasta contenido útil | < 2 s |
| Enviar un mensaje, votar o abrir un chat (tiempo de la API) | p95 < 500 ms |
| Mensaje y voto propios visibles en la MiniApp | Al instante (UI optimista, confirmada con el ack) |
| Mensajes perdidos con envíos concurrentes | 0 |

Cómo se logra:
- **Mensajes en su propia colección**, con inserciones atómicas en lugar de reescribir el documento entero de la solicitud.
- Votos y avales se actualizan con operaciones atómicas (`$set`/`$push`/`$pull` con filtro), nunca con un `updateOne` del agregado completo.
- **Arranque de la app en una sola petición** (`GET /me`). La sincronización con Telegram (miembro, avatar, grupo) se cachea en memoria con TTL de 10 min, y la entrada de un usuario se invalida al instante por eventos (updates `chat_member` del grupo y aprobación de su ingreso), y se ejecuta en paralelo, no en serie.
- El listado de solicitudes devuelve un resumen (último mensaje y conteos de votos) sin cargar todos los mensajes; se pagina el historial.
- La API y MongoDB Atlas en la **misma región**.

### 4.3 Almacenamiento de imágenes (costo $0)

**Decisión: usar Telegram como almacenamiento.**
- El bot sube cada imagen con `sendPhoto` a un **canal privado de almacenamiento** (`TELEGRAM_STORAGE_CHAT_ID`) y se guarda `file_id` / `file_unique_id`.
- La API resuelve `getFile` (su `file_path` vale ≥1 h, así que se cachea con TTL corto) y sirve los bytes por `GET /media/:id` con `Cache-Control: private, max-age=86400`.
- El mismo `file_id` se reutiliza para republicar en el grupo sin volver a subir la imagen.
- Límites: 10 MB por foto subida, 20 MB por descarga vía Bot API.

Alternativas documentadas (precios de referencia, verificar antes de usar):

| Opción | Costo |
|---|---|
| Cloudflare R2 | 10 GB gratis, luego ~$0.015/GB-mes, sin costo de salida |
| Cloudinary | 25 créditos/mes gratis, luego desde ~$89/mes |
| GridFS en Atlas | Comparte los 512 MB del M0 |

**Deuda relacionada:** hoy se guarda el `file_path` de los avatares en la BD, y ese valor caduca. Hay que guardar el `file_id`.

### 4.4 Privacidad

- Los datos del formulario, los votos, los avales y los comentarios solo son visibles para los miembros.
- **Dentro del grupo no hay nada privado:** votos (a favor y en contra), avales y comentarios muestran a su autor (§3.3).
- El solicitante ve su formulario y su chat. Al ingresar se vuelve miembro y ve lo mismo que cualquier miembro, incluida su propia revisión.
- Los mensajes del solicitante se republican en el grupo (§3.5).
- **Retención: indefinida.** No se borran solicitudes, mensajes ni imágenes. Las imágenes son de fursonas (personajes), no fotos de las personas.

---

## 5. Stack técnico

| Capa | Tecnología |
|---|---|
| API | NestJS 11 · TypeScript 5.7 · Express · Socket.IO (`@nestjs/websockets`) |
| Bot | grammY 1.38 (migra de polling a **webhook**) |
| Persistencia | MongoDB (Atlas M0) · Mongoose 8 · UUID como `_id` |
| Configuración | `@nestjs/config` + Joi |
| Validación de DTOs | `class-validator` + `class-transformer` con `ValidationPipe` global |
| Fechas | Luxon. **Se envían en ISO-8601 UTC**; el formato y la zona horaria los decide el cliente (hoy el servidor formatea en `America/Bogota`) |
| MiniApp | React 18 · Vite 6 · Redux Toolkit + RTK Query · `@telegram-apps/sdk-react` 3 · `@telegram-apps/telegram-ui` · `tmaui` · socket.io-client · React Router 6 (HashRouter) |
| Por eliminar | `@tonconnect/ui-react` (no se usa) |

### Variables de entorno

**API**

| Variable | Uso |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token del bot |
| `TELEGRAM_GROUP_ID` | Id del grupo principal |
| `TELEGRAM_STORAGE_CHAT_ID` | **Nueva.** Canal privado donde el bot guarda imágenes |
| `TELEGRAM_WEBHOOK_SECRET` | **Nueva.** Secreto para validar el webhook |
| `TELEGRAM_BOT_LINK` | Deep link a la MiniApp |
| `PUBLIC_API_URL` | **Nueva.** URL pública de la API, para registrar el webhook |
| `DB_URI` | Conexión a MongoDB |
| `FRONTEND_URL` | Origen permitido por CORS |
| `APPROVE_THRESHOLD` / `REJECT_THRESHOLD` | Umbrales de votación (5 y 5) |
| `PORT`, `LOGGER_OPTIONS` | Servidor y logs |

**MiniApp**

| Variable | Uso |
|---|---|
| `VITE_API_URL` | URL de la API |
| ~~`VITE_TELEGRAM_BOT_TOKEN`~~ | **Se elimina** |

---

## 6. Comandos

**API** (`furmeets-api`)
```bash
npm install
npm run start:dev          # desarrollo con watch
docker compose up          # Mongo local + API
npm run build              # nest build → dist/
npm run start:prod         # node dist/main
npm run lint               # eslint --fix
npm test                   # jest (unitarias, *.spec.ts en src/)
npm run test:cov
npm run test:e2e           # jest --config ./test/jest-e2e.json (hay que crear test/)
```

**MiniApp** (`furmeets-mini-app`)
```bash
npm install
npm run dev                # vite
npm run dev:https          # vite con certificado local (mkcert)
npm run build              # tsc --noEmit && vite build
npm run lint
```

---

## 7. Estructura del proyecto

**API**: arquitectura por capas DDD en cada módulo.
```
src/
  <módulo>/
    domain/            → entidades, value objects, interfaces de repositorio (sin Nest ni Mongoose)
    application/       → servicios de casos de uso
    infraestructure/   → repositorios Mongo, schemas, adaptadores de Telegram
    presentation/      → controllers, gateways, DTOs
    mappers/           → dominio ↔ BD ↔ DTO
    <módulo>.module.ts
    <módulo>.providers.ts   → symbols de inyección
  shared/              → Entity, ValueObject, UUID, middlewares/guards
  telegram-bot/        → servicio grammY, webhook, handlers de comandos
  database/            → conexión Mongo
test/                  → e2e (por crear)
```
Módulos actuales: `chat` (→ `applications`, `request-chat` y `review`), `members` (→ `membership`) y `telegram-bot` (→ `telegram-bridge` y `admission`). La carpeta se llama `infraestructure` y el nombre se mantiene por consistencia.

**MiniApp**
```
src/
  components/   → componentes reutilizables (ChatBubble, RequestChatList, FAQ…)
  pages/        → una carpeta por pantalla
  services/     → APIs de RTK Query
  state/        → slices de Redux
  models/       → tipos de los DTOs
  navigation/   → rutas
  helpers/, css/
```

---

## 8. Estilo de código

- **Dominio puro:** las entidades no importan Nest ni Mongoose; las reglas de negocio (umbrales, quién puede votar, edición del formulario) viven en la entidad.
- Constructores privados con fábricas estáticas (`create`, `asNew`). Los repositorios son interfaces en `domain/services` y se inyectan con `Symbol`.
- Los mappers son la única frontera entre dominio, persistencia y DTO.
- Nombres de código en inglés; los textos visibles al usuario, en español.
- Prettier y ESLint del repo; comillas simples en código nuevo.

```ts
export class RequestChatEntity extends Entity<RequestChatProps> {
    private constructor(props: RequestChatProps, id?: UUID) {
        super(props, id);
    }

    static asNew(requester: UserEntity, form: ApplicationForm): RequestChatEntity {
        return new RequestChatEntity({ requester, form, state: RequestChatState.InProgress(), votes: [], /* … */ });
    }

    castVote(voter: Member, type: VoteType): void {
        if (!this.isInProgress()) throw new RequestChatClosedError(this.id);
        if (voter.is(this.props.requester)) throw new CannotVoteOwnRequestError();
        // …
    }
}
```

---

## 9. Plan por fases (resumen; el detalle va en [`docs/features/01-proceso-de-ingreso/`](docs/features/01-proceso-de-ingreso/plan.md))

**Fase 0: urgente, antes de cualquier feature**
1. **Revocar el token del bot con @BotFather** (`/revoke`). El token actual ya está publicado en el bundle de la MiniApp. Actualizar la API y quitarlo de los secretos de Vercel y GitHub.
2. Eliminar `VITE_TELEGRAM_BOT_TOKEN` e implementar el proxy `/media`.
3. Autenticación con `initData` y autorización por rol (HTTP y socket), y salas por solicitud.
4. Corregir la pérdida de datos: mensajes en su propia colección, operaciones atómicas y `createdAt` persistido, **junto con la migración de los datos existentes** (§9.1).
5. Bajar la latencia de las interacciones con el servidor despierto: medir una línea base, sacar a Telegram del camino crítico, índices, listado liviano, actualización en vivo sin recargas y UI optimista. El arranque en frío se resuelve en la Fase 2.

**Fase 1: v1 funcional:** formulario nuevo, chat con imágenes y respuestas, revisión (votos, avales y comentarios, todos con nombre), admisión por solicitud de unión, puente con el grupo.

**Fase 2: rendimiento e infraestructura:** webhook, keep-alive condicional, `GET /me`, caché de membresía, ambientes formalizados.

### 9.1 Migración de datos existentes

Las solicitudes actuales (colección `requestchats`, con mensajes y votos embebidos) **se migran al nuevo modelo**, acoplándolas lo mejor posible:

| Dato actual | Destino en el nuevo modelo |
|---|---|
| `requester`, `state`, `createdAt` | Se conservan tal cual |
| `whereYouFoundUs` | → "¿Cómo conociste FurMeets?", en `legacy.howDidYouFindUs` |
| `interests` | → campo legado `legacy.interests`, que se muestra en el *Resumen* |
| Campos nuevos del formulario (fursona, edad, etc.) | Vacíos (sin `form`). La solicitud lleva el bloque `legacy`, que equivale a `legacy: true`. Toda solicitud sin `form` se marca así, también las creadas con el formulario anterior hasta T15 |
| `messages[]` embebidos | → colección de mensajes, conservando solo `_id`, autor, contenido y `createdAt`. `createdAt` se toma de lo que haya en BD (puede estar alterado por el bug de la deuda #5; se acepta) |
| `votes[]` | → votos, con su votante. Se muestran según la regla vigente de §3.3 (hoy, todos nominales para los miembros) |
| `users.avatarUrl` (`file_path` caducable) | Se descarta; el avatar se resincroniza como `file_id` en la siguiente sincronización del usuario |
| `users.species` (enum) | → texto libre (el dato ya es texto; el código dejó de exigir el enum) |

Reglas de la migración:
- Es un script **idempotente** (se puede correr varias veces sin duplicar), versionado en el repo.
- Se ensaya primero en staging, con una copia de la BD de producción.
- En producción se corre con respaldo previo (export de Atlas). Requiere aprobación (§12, *preguntar primero*).
- La colección original se conserva como copia (`requestchats_pre_001`) hasta verificar la migración. No se borra. Se copia en lugar de renombrar para que la colección viva conserve sus índices.

---

## 10. Infraestructura y ambientes

### Hosting (decisión: $0)

- **API + bot:** Render free con **webhook** y **keep-alive condicional**. El servidor solo se mantiene despierto **mientras haya al menos una solicitud en curso**. Cuando no queda ninguna, se deja que se enfríe (Render lo duerme tras ~15 min sin tráfico).
  - **Mecanismo (auto-ping):**
    - Al arrancar y cada vez que una solicitud se crea o se cierra, la API revisa si hay solicitudes *InProgress*.
    - Si las hay, programa un ping a su propia URL pública (`PUBLIC_API_URL`, `GET /`) cada 10 min. Pasa por el proxy de Render, así que cuenta como tráfico entrante.
    - Si no quedan, cancela el ping.
    - Costo $0 y sin dependencias externas. **Verificar en staging** que el auto-ping efectivamente evita que Render lo duerma.
  - **Alternativa, si el auto-ping no funciona:** un job de cron-job.org (gratis) que la API activa y desactiva a través de la API REST de cron-job.org, con los mismos disparadores.
  - Mientras el servidor duerme, cualquier interacción lo despierta: abrir la MiniApp o un update del bot vía webhook. El primer usuario sufre el arranque en frío.
  - Riesgo: mantener el servicio despierto es zona gris en los términos de Render; hacerlo solo mientras hay solicitudes lo reduce. Sigue teniendo 0.1 CPU.
  - Plan B (pago): Render Starter, ~$7/mes, siempre encendido y 0.5 CPU.
  - Alternativa gratuita más rápida: VM ARM Always Free de Oracle Cloud (requiere administrarla).
- **BD:** MongoDB Atlas M0, en la misma región que la API.
- **MiniApp:** Vercel (producción) y GitHub Pages (staging).

### Ambientes

| | Staging | Producción |
|---|---|---|
| Rama | `development` | `main` |
| MiniApp | GitHub Pages (el workflow se dispara con `development`) | Vercel (integración con Git sobre `main`) |
| API | Servicio Render aparte, **sin** keep-alive (puede dormir) | Render free + webhook + keep-alive condicional |
| Bot | `@furmeets_test_bot` | `@furmeets_bot` |
| Grupo | Grupo de prueba | Grupo FurMeets |
| BD | Atlas M0 en un **proyecto Atlas separado** (hay un M0 por proyecto) | Atlas M0 |

Pendientes de `platform`:
- El workflow de GitHub Pages hoy se dispara con `main` y debe dispararse con `development`.
- Corregir el `README` y el `homepage` de la MiniApp.
- **Arreglar el Dockerfile de producción**: `npm ci --only=production` seguido de `nest build` falla porque el CLI es una devDependency. Usar un build de varias etapas.
- Unificar la versión de Node (hoy: Dockerfile 23, CI 18) en la LTS vigente.

---

## 11. Estrategia de pruebas

Hoy **no existe ninguna prueba**.

| Nivel | Qué cubre | Herramienta |
|---|---|---|
| Unitarias (API) | Entidades de dominio (umbrales, cambio o retiro de voto, cierre, "no votar la propia", formulario no editable, máximo 3 imágenes, etiqueta de menor); **ninguna salida dirigida al solicitante incluye votos, avales ni comentarios**; validación de `initData`; activación y desactivación del keep-alive; script de migración (idempotencia) | Jest (ya configurado), `src/**/*.spec.ts` |
| Integración/e2e (API) | Autorización por rol en cada endpoint y evento; envíos concurrentes sin pérdida; flujo de *join request* con el bot simulado | Jest + supertest (ya instalados). Una BD en memoria (`mongodb-memory-server`) requiere aprobación como dependencia nueva |
| MiniApp | Por definir. Sugerido: Vitest + Testing Library para la lógica de rutas por rol (requiere aprobar dependencias) | — |
| Manual | Flujo completo en staging con el bot y el grupo de prueba antes de cada merge a `main` | — |

Cobertura mínima esperada: 80 % en `domain/` y en `auth`.

---

## 12. Límites

**Siempre**
- Validar `initData` y autorizar por rol **en el backend**, en HTTP y en sockets.
- Correr `lint`, `build` y `test` antes de cada commit.
- Proponer primero la opción de costo $0; si no existe, documentar el precio.
- Persistir antes de notificar; las llamadas a Telegram nunca bloquean el flujo principal.
- Probar en staging antes de hacer merge a `main`.

**Preguntar primero**
- Cambios de esquema o migraciones sobre datos de producción.
- Agregar dependencias.
- Cualquier servicio pago.
- Cambiar umbrales, reglas de admisión o visibilidad de datos.
- Cambios en CI/CD o en la configuración de Render, Vercel o Atlas.

**Nunca**
- Poner secretos en variables `VITE_*` ni en el repo (`.env` está en `.gitignore`).
- Confiar en ids de usuario que envía el cliente.
- Hacer broadcast global por socket.
- Mostrarle al solicitante, mientras no sea miembro, los votos, avales o comentarios de su solicitud (API o socket).
- Desactivar la autenticación "para probar" en producción.
- Borrar datos de producción.
- Hacer push directo a `main`.

---

## 13. Criterios de éxito

1. Una petición o evento de socket sin `initData` válido responde 401 o es rechazada.
2. Un solicitante que pide la solicitud de otra persona recibe 403. Un solicitante que intenta votar recibe 403.
3. El bundle de producción de la MiniApp no contiene el token del bot ni `api.telegram.org/file/bot`.
4. Un solicitante conectado **no recibe** eventos de otras solicitudes.
5. 20 mensajes concurrentes en el mismo chat quedan los 20 persistidos, en orden y con su `createdAt` original.
6. Al llegar a `APPROVE_THRESHOLD` aprobaciones, la solicitud pasa a *Approved*, se genera un enlace con `creates_join_request` y solo el usuario aprobado es aceptado; otra cuenta con el mismo enlace es rechazada.
7. Cada mensaje del solicitante aparece en el grupo principal. Un *reply* de un miembro a ese mensaje aparece en el chat de la MiniApp.
8. Si falla el DM al solicitante (sin permiso), el mensaje igual se entrega por socket.
9. Los miembros ven los avales y los comentarios con su autor, y quién votó a favor y quién en contra.
10. Mientras el solicitante no sea miembro, ninguna respuesta de la API ni evento de socket que recibe contiene votos, avales ni comentarios de su solicitud.
11. El formulario rechaza más de 3 imágenes y no acepta modificaciones una vez enviado.
12. Con el servidor despierto, la entrega de un mensaje tiene p95 < 1 s, enviar, votar y abrir un chat tienen p95 < 500 ms en la API, el mensaje y el voto propios se ven al instante y la carga inicial tarda < 2 s.
13. Con al menos una solicitud en curso, la API de producción no se duerme. Sin solicitudes en curso, deja de hacerse ping.
14. Tras la migración, todas las solicitudes existentes se abren en la MiniApp con sus mensajes y votos, y ningún mensaje queda sin migrar (mismo conteo antes y después).
15. Staging y producción están aislados (bot, grupo, BD y API distintos) y se despliegan desde `development` y `main`.

---

## 14. Deuda técnica conocida

Encontrada en la revisión del 2026-09-29.

| # | Problema | Dónde |
|---|---|---|
| 1 | Token del bot en el bundle | `mini-app/src/state/hub.slice.ts`, `request-chat.slice.ts` |
| 2 | Autenticación por el header `x-telegram-id`, falsificable | `src/shared/middlewares/user.middleware.ts` |
| 3 | El socket usa el `userUUID` que envía el cliente y `server.emit` global | `src/chat/presentation/chat.gateway.ts` |
| 4 | `requesterUUID` viene en el body; no se verifica el rol al votar ni al leer | `request-chat.controller.ts`, `chat.service.ts` |
| 5 | El agregado entero se reescribe en cada lectura, mensaje o voto (condiciones de carrera); el mapper no persiste `createdAt`, y `viewedAt` no coincide con `createdAt` del schema | `chat-mongo.repository.ts`, `request-chat-message.mapper.ts` |
| 6 | `getRequestChatByUUID` guarda en cada lectura (marca leídos) | `chat.service.ts` |
| 7 | Las notificaciones de Telegram se esperan (`await`) sin capturar errores dentro del flujo del mensaje | `chat.service.ts` |
| 8 | El enlace de invitación con `member_limit: 1` es reenviable; `:new_chat_members` no hace nada | `telegram-bot.service.ts` |
| 9 | La membresía se decide por `group.members` en BD, que queda desactualizada | `RequireBeMember.tsx`, `groups.service.ts` |
| 10 | Se guarda el `file_path` de los avatares (caduca) | `user-mongo.repository.ts` |
| 11 | Sin validación de DTOs (`vote/:type` acepta cualquier string) | `presentation/dtos` |
| 12 | Hack de prueba `isRequester` con id `123456789`; `telegramUserId \|\| 1` | `IndexPage.tsx` |
| 13 | Hooks después de un `return` temprano; `backgroundColor: 'red'` | `RegisterPage.tsx` |
| 14 | `TonConnectUIProvider` sin uso; avatar por defecto de GitHub | `Root.tsx`, `ChatBubble.tsx` |
| 15 | El Dockerfile de producción no compila; versiones de Node inconsistentes | `Dockerfile`, workflow |
| 16 | Fechas formateadas en el servidor con zona fija | `chat-date.value-object.ts` |
| 17 | El flujo `POST /users` es código muerto (el middleware devuelve 401 antes del 404) | `users.controller.ts`, `user.service.ts` (MiniApp) |
| 18 | Archivo con errata `app.controler.ts` (sin commit) | `src/` |
| 19 | `ValueObject.equals` devuelve `true` para cualquier par (no compara `props`). Encontrado en T41 | `src/shared/domain/value-objects/value-object.ts` |

---

## 15. Preguntas abiertas

No hay preguntas abiertas.

### Resueltas (2026-09-29)

- Campos obligatorios: solo edad y ciudad. La fursona es opcional.
- ~~Los comentarios privados son anónimos. En la fila de avatares solo aparecen quienes aprobaron.~~ Reemplazado el 2026-10-03: nada es anónimo dentro del grupo.
- La revisión de la propia solicitud **no se oculta** al ingresar (§3.3). ~~Los votos en contra son anónimos para todos.~~ Reemplazado el 2026-10-03.
- Imágenes: máximo 3 en el formulario y sin límite en el chat.
- El formulario no se puede editar una vez enviado.
- Retención de datos indefinida. Las imágenes son de fursonas, no de personas.
- El enlace de invitación no caduca.
- Las solicitudes existentes se migran al nuevo modelo (§9.1).
- Keep-alive solo mientras haya solicitudes en curso (§10).

### Resueltas (2026-10-02 y 2026-10-03)

- El formulario ya no pide aceptar las reglas de convivencia ni enlaza a ellas: no hay enlace de reglas (2026-10-03).
- Se quitan los leídos: ni "Leído por" (quién vio cada mensaje y cuándo) ni contador de no leídos. Aportan poco y complican el modelo (§3.2).
- **Nada es anónimo dentro del grupo** (2026-10-03): votos a favor y en contra, avales y comentarios muestran a su autor a todos los miembros. El solicitante sigue sin ver la revisión mientras no sea miembro (§3.3, §4.4).
- Umbrales: `APPROVE_THRESHOLD` y `REJECT_THRESHOLD` siguen separados y los dos valen 5 (2026-10-03).
- No se piden pronombres en el formulario (2026-10-03).
- Las reglas de convivencia tampoco aparecen en *Aprobado* ni en *Carga* (2026-10-03).
- "Contactar a un admin" en *Carga* abre `https://t.me/DarvandFrovonwill` (2026-10-03).

### Resueltas (2026-10-04)

- El formulario ya no avisa que el envío es definitivo ni que los mensajes del chat se comparten en el grupo; tampoco muestra el aviso de la etiqueta "Menor de edad" mientras se llena. La etiqueta sigue en la solicitud (§3.1).
- *No aprobado* no promete otra solicitud con un aval, aunque el diseño lo diga: rehabilitar sigue siendo manual (2026-10-03, §3.6).
