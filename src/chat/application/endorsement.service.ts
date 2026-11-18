import { forwardRef, Inject, Injectable } from '@nestjs/common';
import type { Endorsement } from 'src/review/domain/endorsement';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { CHAT_PROVIDERS } from '../chat.providers';
import type { ChatRepository } from '../domain/services/chat.repository';
import { ChatGateway } from '../presentation/chat.gateway';
import { reviewRejection } from './review-rejection';

/** Los avales de una solicitud tras avalar o retirar un aval. */
export interface EndorsementsResult {
  requestChatId: UUID;
  endorsements: Endorsement[];
}

/**
 * "Lo conozco, lo avalo" (SPEC §3.3): un aval por miembro, informativo, que se puede
 * retirar. Cada cambio es una operación atómica más la lectura de quién avaló; los demás
 * miembros lo ven en vivo. La ruta ya decidió que es miembro (`@MembersOnly()`).
 */
@Injectable()
export class EndorsementService {
  constructor(
    @Inject(CHAT_PROVIDERS.RequestChatRepository)
    private readonly requestChatRepository: ChatRepository,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
  ) {}

  /** Avala la solicitud; avalar dos veces no duplica. Propia → 403; cerrada → 409. */
  async endorse(
    requestChatId: UUID,
    member: UserEntity,
  ): Promise<EndorsementsResult> {
    return this.applied(
      requestChatId,
      member,
      await this.requestChatRepository.endorse(
        requestChatId,
        member.id,
        new Date(),
      ),
    );
  }

  /** Retira el aval; sin aval previo no cambia nada. Propia → 403; cerrada → 409. */
  async withdraw(
    requestChatId: UUID,
    member: UserEntity,
  ): Promise<EndorsementsResult> {
    return this.applied(
      requestChatId,
      member,
      await this.requestChatRepository.withdrawEndorsement(
        requestChatId,
        member.id,
      ),
    );
  }

  private async applied(
    requestChatId: UUID,
    member: UserEntity,
    endorsements: Endorsement[] | null,
  ): Promise<EndorsementsResult> {
    if (!endorsements) {
      throw await reviewRejection(
        this.requestChatRepository,
        requestChatId,
        member.id,
      );
    }
    const result = { requestChatId, endorsements };
    this.chatGateway.emitEndorsements(result);
    return result;
  }
}
