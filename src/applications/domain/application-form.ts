import { ValueObject } from 'src/shared/domain/value-objects/value-object';

/** Edad desde la que una solicitud ya no lleva la etiqueta "Menor de edad". */
export const ADULT_AGE = 18;

/** Fotos o referencias de la fursona que admite el formulario (SPEC §3.1). */
export const MAX_FORM_IMAGES = 3;

/** Lo que envía el solicitante (SPEC §3.1). */
export interface ApplicationFormProps {
  /** Ids de `media` subidos antes con `POST /media`, en el orden elegido. */
  imageIds?: readonly string[];
  fursonaName?: string;
  species?: string;
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
    const imageIds = input.imageIds ?? [];
    if (imageIds.length > MAX_FORM_IMAGES) {
      throw new InvalidApplicationFormError(
        `at most ${MAX_FORM_IMAGES} images are allowed`,
      );
    }
    if (new Set(imageIds).size !== imageIds.length) {
      throw new InvalidApplicationFormError('images must not repeat');
    }
    if (imageIds.length) {
      props.imageIds = Object.freeze([...imageIds]);
    }
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
    if (props.imageIds) {
      props = { ...props, imageIds: Object.freeze([...props.imageIds]) };
    }
    return new ApplicationForm(props);
  }

  /** La solicitud lleva la etiqueta visible "Menor de edad". */
  get isMinor(): boolean {
    return this.props.age < ADULT_AGE;
  }
}
