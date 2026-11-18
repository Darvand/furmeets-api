# ADR-001: DDD pragmático para un servidor liviano

## Estado
Aceptada

## Fecha
2026-10-01

## Contexto

La API corre en Render free, con 0,1 de CPU y poca memoria, y la Fase 0 tiene metas explícitas de latencia (RNF-REN-02, REN-03, REN-06 a REN-08). El código ya usa capas de DDD (`domain`, `application`, `infraestructure`, `presentation`), pero de forma desigual:

- Algunas reglas de negocio viven en los repositorios de Mongo y no en las entidades. Ejemplo: la primera versión del upsert de T03 decidía con `$set`/`$setOnInsert` qué datos de Telegram se actualizaban.
- El agregado `RequestChat` se carga completo, con todos sus mensajes y 4 `populate`, y se reescribe entero al guardarse. Es una de las causas de la lentitud actual (causas #3 y #5 de [plan.md](../features/01-proceso-de-ingreso/plan.md)).

Surgió la duda de si DDD es demasiado pesado para este servidor y conviene algo más liviano.

Lo que cuesta en este servidor:

- **Llamadas de red.** Un viaje a Mongo Atlas tarda decenas de ms y uno a Telegram, cientos. Crear una entidad o mapearla a DTO cuesta microsegundos y no se nota.
- **CPU y memoria.** Las consumen hidratar documentos de Mongoose (en lugar de usar `lean()`), traer documentos grandes completos, serializar objetos para logs de `debug` y mantener cachés sin límite.

El patrón de diseño no cambia ninguno de esos costos. La disciplina de acceso a datos sí.

## Decisión

Mantener DDD, de forma pragmática, con estas reglas:

1. **Las reglas de negocio van en el dominio.** Entidades y value objects deciden qué cambia (umbrales de voto, quién puede votar, anonimato del voto, admisión, qué datos se toman de Telegram). No hacen E/S y se prueban con unitarias sin BD.
2. **Las escrituras son atómicas y mínimas.** Se carga solo lo necesario, la entidad aplica la regla e informa qué cambió, y el repositorio lo traduce a una operación puntual (`$set`, `$push`, `$pull`, `$inc`). Nunca se reescribe el documento completo. Si nada cambió, no se escribe.
3. **Las lecturas para mostrar datos no pasan por el dominio.** Listados y pantallas consultan con `lean()` y proyección y devuelven DTOs directamente; no se hidratan entidades solo para leer (es CQRS-lite).
4. **Los agregados son pequeños.** Lo que crece sin límite (mensajes, imágenes) va en su propia colección, como ya decide T10.
5. **La organización sigue los módulos de Nest del plan** (`auth`, `membership`, `request-chat`…). Si un módulo crece, se separa por caso de uso dentro de él.
6. **No hay refactor aparte.** Las reglas se aplican a medida que cada tarea toca un módulo.
7. **Antes de sacrificar estructura por rendimiento, se mide** con las líneas `Timing` de T37 (ms y número de comandos de Mongo y Telegram por ruta).

### Ejemplo: autenticación por `initData` (T03)

- `TelegramIdentity` (value object) representa lo que Telegram firma.
- `UserEntity.registerFromTelegram` y `UserEntity.refreshFrom` deciden qué se crea y qué se actualiza. `refreshFrom` devuelve si algo cambió.
- `UserService.authenticate` orquesta, y el repositorio solo hace `create` o un `$set` del nombre y el usuario.
- El caso común (usuario existente, sin cambios) es **una sola lectura indexada**. Solo se escribe en el primer ingreso o si cambió el nombre o el usuario en Telegram.
- La carrera de dos primeros ingresos simultáneos la resuelve el índice único de `telegramId`: el repositorio traduce el `E11000` a `DuplicateUserError` y el servicio vuelve a leer.

## Alternativas consideradas

### Transaction script (servicios con consultas directas, sin entidades)
- A favor: es lo más simple y no requiere mapeo.
- En contra: las reglas quedan dispersas en servicios y consultas, y solo se pueden probar con BD.
- Descartada: el núcleo de FurMeets son reglas (votación, anonimato, admisión, solo lectura). Para CRUD sin reglas sigue siendo válido dentro de un módulo, bajo la regla 3.

### Vertical slices (una carpeta por caso de uso)
- A favor: cada caso de uso optimiza su propia consulta.
- En contra: organiza carpetas, pero no da un modelo para las reglas.
- No se adopta como enfoque principal: se puede usar dentro de un módulo grande (regla 5).

### CQRS-lite y "functional core, imperative shell"
- No compiten con esta decisión: ya forman parte de ella (reglas 3 y 1).

### DDD sin ajustes (cargar el agregado completo y guardarlo entero)
- Descartada: es la causa de las lecturas y reescrituras pesadas de `RequestChat` que el plan corrige en T10, T11 y T40.

## Consecuencias

- Las reglas se prueban con unitarias rápidas y sin BD.
- Cada repositorio necesita métodos de escritura específicos (`updateTelegramProfile`, `addVote`…) en lugar de un `save` genérico. Hay más métodos, pero cada uno es una operación barata.
- Las consultas de lectura usan DTOs que pueden duplicar algunos campos de las entidades. Es aceptable: así no se hidrata nada para mostrar datos.
- El `save` genérico que reescribe el documento completo queda solo para código existente y se reemplaza a medida que cada tarea lo toque.
- Revisar un PR incluye verificar estas reglas: ninguna regla de negocio en un repositorio, ninguna lectura de pantalla que hidrate entidades y ninguna escritura que reescriba el documento completo.
