import { ValueObject } from 'src/shared/domain/value-objects/value-object';

/** Edad desde la que una solicitud ya no lleva la etiqueta "Menor de edad". */
export const ADULT_AGE = 18;

/** Lo que envía el solicitante (SPEC §3.1). Las imágenes llegan con T14. */
export interface ApplicationFormProps {
  fursonaName?: string;
  species?: string;
  pronouns?: string;
  age: number;
  city: string;
  socialLinks?: string;
  howDidYouFindUs?: string;
  knowsSomeone?: string;
  previousMeets?: string;
}

/** El formulario no cumple una regla de SPEC §3.1. */
export class InvalidApplicationFormError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid application form: ${reason}`);
    this.name = InvalidApplicationFormError.name;
  }
}

const OPTIONAL_TEXTS = [
  'fursonaName',
  'species',
  'pronouns',
  'socialLinks',
  'howDidYouFindUs',
  'knowsSomeone',
  'previousMeets',
] as const;

/**
 * Formulario de solicitud (SPEC §3.1). Solo la edad (entero > 0) y la ciudad son
 * obligatorias; lo de la fursona es opcional. No se puede editar: no tiene métodos que lo
 * cambien y sus datos quedan congelados al crearlo.
 */
export class ApplicationForm extends ValueObject<ApplicationFormProps> {
  private constructor(props: ApplicationFormProps) {
    super(props);
  }

  /** Valida y normaliza lo enviado: recorta textos y descarta los vacíos. */
  static submit(input: ApplicationFormProps): ApplicationForm {
    if (!Number.isInteger(input.age) || input.age <= 0) {
      throw new InvalidApplicationFormError('age must be a positive integer');
    }
    const city = input.city?.trim();
    if (!city) {
      throw new InvalidApplicationFormError('city is required');
    }
    const props: ApplicationFormProps = { age: input.age, city };
    for (const key of OPTIONAL_TEXTS) {
      const value = input[key]?.trim();
      if (value) {
        props[key] = value;
      }
    }
    return new ApplicationForm(props);
  }

  /** Reconstruye un formulario ya guardado, sin volver a validarlo. */
  static restore(props: ApplicationFormProps): ApplicationForm {
    return new ApplicationForm(props);
  }

  /** La solicitud lleva la etiqueta visible "Menor de edad". */
  get isMinor(): boolean {
    return this.props.age < ADULT_AGE;
  }
}
