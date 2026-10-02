/** Formatos de imagen aceptados al subir (SPEC §1: JPEG/PNG/WebP). */
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Tamaño máximo por imagen subida (SPEC §4.3; también es el límite de `sendPhoto`). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Tipo de imagen según sus primeros bytes, no según el `Content-Type` que manda el
 * cliente. `undefined` si no es JPEG, PNG ni WebP.
 */
export function detectImageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  // RIFF <tamaño de 4 bytes> WEBP
  if (
    startsWith(bytes, ascii('RIFF')) &&
    startsWith(bytes.subarray(8), ascii('WEBP'))
  ) {
    return 'image/webp';
  }
  return undefined;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return (
    bytes.length >= prefix.length &&
    prefix.every((byte, i) => bytes[i] === byte)
  );
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}
