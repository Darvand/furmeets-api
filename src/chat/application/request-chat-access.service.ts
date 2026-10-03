import { Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { MembershipService } from 'src/membership/application/membership.service';
import { Roles } from 'src/membership/domain/role';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { CHAT_PROVIDERS } from '../chat.providers';
import type {
  ChatRepository,
  RequestChatHeader,
} from '../domain/services/chat.repository';

/**
 * Quién puede ver una solicitud y escribir en su chat (RNF-SEG-04, PRI-03): cualquier
 * miembro, o el solicitante dueño de esa solicitud. Lo usan el guard HTTP
 * (`@OwnerOrMember()`) y el gateway, así ambos deciden igual.
 */
@Injectable()
export class RequestChatAccessService {
  constructor(
    private readonly membershipService: MembershipService,
    @Inject(CHAT_PROVIDERS.RequestChatRepository)
    private readonly requestChatRepository: ChatRepository,
  ) {}

  async canAccess(user: UserEntity, requestChatId: string): Promise<boolean> {
    if (await this.isMember(user)) {
      return true;
    }
    if (!isUUID(requestChatId)) {
      return false;
    }
    const header = await this.requestChatRepository.findHeader(
      UUID.from(requestChatId),
    );
    return this.isOwner(user, header);
  }

  /**
   * Igual que `canAccess`, con la solicitud ya leída (`null` si no existe), para no
   * leerla dos veces.
   */
  async canAccessLoaded(
    user: UserEntity,
    header: RequestChatHeader | null,
  ): Promise<boolean> {
    return this.isOwner(user, header) || (await this.isMember(user));
  }

  private async isMember(user: UserEntity): Promise<boolean> {
    return (await this.membershipService.resolveRole(user)) === Roles.Member;
  }

  private isOwner(user: UserEntity, header: RequestChatHeader | null): boolean {
    return header?.requesterId.value === user.id.value;
  }
}
