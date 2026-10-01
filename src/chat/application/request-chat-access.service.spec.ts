import { randomUUID } from 'crypto';
import { MembershipService } from 'src/membership/application/membership.service';
import { Role } from 'src/membership/domain/role';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { TelegramIdentity } from 'src/members/domain/value-objects/telegram-identity.value-object';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type { ChatRepository } from '../domain/services/chat.repository';
import { RequestChatAccessService } from './request-chat-access.service';

const user = UserEntity.registerFromTelegram(
  TelegramIdentity.create({ telegramId: 1, firstName: 'Ana' }),
);

function setup(role: Role, requesterId: UUID | null) {
  const findRequesterId = jest.fn().mockResolvedValue(requesterId);
  const service = new RequestChatAccessService(
    {
      resolveRole: jest.fn().mockResolvedValue(role),
    } as unknown as MembershipService,
    { findRequesterId } as unknown as ChatRepository,
  );
  return { service, findRequesterId };
}

describe('RequestChatAccessService', () => {
  it('un miembro accede a cualquier solicitud sin consultar la BD', async () => {
    const { service, findRequesterId } = setup('member', null);

    expect(await service.canAccess(user, randomUUID())).toBe(true);
    expect(findRequesterId).not.toHaveBeenCalled();
  });

  it('un solicitante accede a su propia solicitud', async () => {
    const { service } = setup('applicant', user.id);

    expect(await service.canAccess(user, randomUUID())).toBe(true);
  });

  it('un solicitante no accede a la solicitud de otro', async () => {
    const { service } = setup('applicant', UUID.generate());

    expect(await service.canAccess(user, randomUUID())).toBe(false);
  });

  it('un solicitante no accede a una solicitud que no existe', async () => {
    const { service } = setup('applicant', null);

    expect(await service.canAccess(user, randomUUID())).toBe(false);
  });

  it('un id que no es UUID se rechaza sin consultar la BD', async () => {
    const { service, findRequesterId } = setup('applicant', user.id);

    expect(await service.canAccess(user, 'no-es-uuid')).toBe(false);
    expect(findRequesterId).not.toHaveBeenCalled();
  });
});
