import {
  ConflictException,
  ForbiddenException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  CannotReviewOwnRequestError,
  RequestChatClosedError,
  RequestChatEntity,
} from '../domain/entities/request-chat.entity';
import type { ChatRepository } from '../domain/services/chat.repository';

/**
 * Por qué no se aplicó un voto o un aval, fuera del camino feliz (la operación atómica no
 * encontró la solicitud): no existe (404), es de quien revisa (403) o ya se cerró (409).
 */
export async function reviewRejection(
  requestChats: ChatRepository,
  id: UUID,
  member: UUID,
): Promise<HttpException> {
  const header = await requestChats.findHeader(id);
  if (!header) {
    return new NotFoundException(`RequestChat with ID ${id.value} not found`);
  }
  try {
    RequestChatEntity.assertAcceptsReviewFrom(header, member);
  } catch (error) {
    if (error instanceof CannotReviewOwnRequestError) {
      return new ForbiddenException('Cannot review own request chat');
    }
    if (!(error instanceof RequestChatClosedError)) {
      throw error;
    }
  }
  // Cerrada, o cerrada justo después del intento: los estados finales no vuelven atrás.
  return new ConflictException('The request chat is not in progress');
}
