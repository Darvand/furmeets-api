import { BadRequestException } from '@nestjs/common';
import type { RequestChatCursor } from '../domain/services/chat.repository';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor opaco del listado: fecha e id de la última solicitud de la página, en
 * base64url. El cliente solo lo devuelve tal cual.
 */
export const RequestChatCursorCodec = {
  encode(cursor: RequestChatCursor): string {
    return Buffer.from(
      JSON.stringify([cursor.createdAt.toISOString(), cursor.id.value]),
    ).toString('base64url');
  },

  /** 400 si el cursor no es uno que haya emitido `encode`. */
  decode(raw: string): RequestChatCursor {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      throw invalid();
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !UUID_PATTERN.test(parsed[1])
    ) {
      throw invalid();
    }
    const createdAt = new Date(parsed[0]);
    if (Number.isNaN(createdAt.getTime())) {
      throw invalid();
    }
    return { createdAt, id: UUID.from(parsed[1]) };
  },
};

function invalid(): BadRequestException {
  return new BadRequestException('Invalid cursor');
}
