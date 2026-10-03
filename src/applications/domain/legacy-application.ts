/**
 * Respuestas del formulario anterior al actual (SPEC §9.1). Que una solicitud lo tenga
 * equivale a `legacy: true`: la App la muestra como "Solicitud anterior al formulario
 * actual". Las crea la migración de T12 y, hasta T15, `POST /request-chats`.
 */
export interface LegacyApplication {
  /** Antes `whereYouFoundUs`; es la pregunta "¿Cómo conociste FurMeets?". */
  howDidYouFindUs?: string;
  interests?: string;
}

/** Recorta las respuestas y descarta las vacías. Siempre devuelve el bloque. */
export function legacyApplication(
  whereYouFoundUs?: string,
  interests?: string,
): LegacyApplication {
  const legacy: LegacyApplication = {};
  const howDidYouFindUs = whereYouFoundUs?.trim();
  if (howDidYouFindUs) {
    legacy.howDidYouFindUs = howDidYouFindUs;
  }
  const trimmedInterests = interests?.trim();
  if (trimmedInterests) {
    legacy.interests = trimmedInterests;
  }
  return legacy;
}
