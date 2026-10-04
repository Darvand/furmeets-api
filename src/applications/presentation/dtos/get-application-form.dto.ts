/** Formulario de una solicitud, para el solicitante y los miembros. */
export class GetApplicationFormDto {
  /** Se ven con `GET /media/:id`: las ve el solicitante y cualquier miembro. */
  imageIds?: readonly string[];
  fursonaName?: string;
  species?: string;
  age: number;
  city: string;
  socialLinks?: string;
  howDidYouFindUs?: string;
  knowsSomeone?: string;
  previousMeets?: string;
  /** Edad menor de 18: la solicitud lleva la etiqueta visible "Menor de edad". */
  isMinor: boolean;
}
