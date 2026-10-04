/**
 * Respuestas del formulario anterior al actual (SPEC §9.1). Que una solicitud lo tenga
 * equivale a `legacy: true`: la App la muestra como "Solicitud anterior al formulario
 * actual". Solo las tienen las solicitudes que migró T12: desde T15 toda solicitud nueva
 * llega por `POST /applications`.
 */
export interface LegacyApplication {
  /** Antes `whereYouFoundUs`; es la pregunta "¿Cómo conociste FurMeets?". */
  howDidYouFindUs?: string;
  interests?: string;
}
