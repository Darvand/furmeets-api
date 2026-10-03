/** Formulario de una solicitud, para el solicitante y los miembros. */
export class GetApplicationFormDto {
  fursonaName?: string;
  species?: string;
  pronouns?: string;
  age: number;
  city: string;
  socialLinks?: string;
  howDidYouFindUs?: string;
  knowsSomeone?: string;
  previousMeets?: string;
  /** Edad menor de 18: la solicitud lleva la etiqueta visible "Menor de edad". */
  isMinor: boolean;
}
