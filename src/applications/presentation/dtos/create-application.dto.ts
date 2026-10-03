import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Textos cortos (nombre, especie, ciudad…) y largos (respuestas). */
const SHORT_TEXT = 100;
const LONG_TEXT = 2_000;

/**
 * `POST /applications` (SPEC §3.1). Solo edad y ciudad son obligatorias. El solicitante es
 * siempre el usuario autenticado.
 */
export class CreateApplicationDto {
  /**
   * Ignorado: el solicitante sale del `initData`. Se acepta solo para que un cliente que
   * aún lo envía no reciba 400 (RNF-SEG-02).
   */
  @IsOptional()
  @IsUUID()
  requesterUUID?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT)
  fursonaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT)
  species?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT)
  pronouns?: string;

  /** Entero > 0. El tope solo descarta errores de tipeo. */
  @IsInt()
  @Min(1)
  @Max(120)
  age: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(SHORT_TEXT)
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT)
  socialLinks?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT)
  howDidYouFindUs?: string;

  @IsOptional()
  @IsString()
  @MaxLength(SHORT_TEXT)
  knowsSomeone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(LONG_TEXT)
  previousMeets?: string;
}
