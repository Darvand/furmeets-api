import { randomUUID } from 'crypto';
import { MembershipService } from 'src/membership/application/membership.service';
import { Role } from 'src/membership/domain/role';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { TelegramIdentity } from 'src/members/domain/value-objects/telegram-identity.value-object';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type {
  ChatRepository,
  RequestChatHeader,
} from '../domain/services/chat.repository';
import { RequestChatAccessService } from './request-chat-access.service';

const user = UserEntity.registerFromTelegram(
  TelegramIdentity.create({ telegramId: 1, firstName: 'Ana' }),
);

const headerOf = (requesterId: UUID): RequestChatHeader => ({
  id: UUID.generate(),
  requesterId,
  state: 'InProgress',
});

function setup(role: Role, requesterId: UUID | null) {
  const findHeader = jest
    .fn()
    .mockResolvedValue(requesterId && headerOf(requesterId));
  const resolveRole = jest.fn().mockResolvedValue(role);
  const service = new RequestChatAccessService(
    { resolveRole } as unknown as MembershipService,
    { findHeader } as unknown as ChatRepository,
  );
  return { service, findHeader, resolveRole };
}

describe('RequestChatAccessService', () => {
  it('un miembro accede a cualquier solicitud sin consultar la BD', async () => {
    const { service, findHeader } = setup('member', null);

    expect(await service.canAccess(user, randomUUID())).toBe(true);
    expect(findHeader).not.toHaveBeenCalled();
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
    const { service, findHeader } = setup('applicant', user.id);

    expect(await service.canAccess(user, 'no-es-uuid')).toBe(false);
    expect(findHeader).not.toHaveBeenCalled();
  });

  describe('canAccessLoaded', () => {
    it('el dueño accede sin consultar su rol ni la BD', async () => {
      const { service, findHeader, resolveRole } = setup('applicant', null);

      expect(await service.canAccessLoaded(user, headerOf(user.id))).toBe(true);
      expect(resolveRole).not.toHaveBeenCalled();
      expect(findHeader).not.toHaveBeenCalled();
    });

    it('un miembro accede aunque la solicitud no exista', async () => {
      const { service } = setup('member', null);

      expect(await service.canAccessLoaded(user, null)).toBe(true);
    });

    it('un solicitante no accede a la solicitud de otro ni a una que no existe', async () => {
      const { service } = setup('applicant', null);

      expect(
        await service.canAccessLoaded(user, headerOf(UUID.generate())),
      ).toBe(false);
      expect(await service.canAccessLoaded(user, null)).toBe(false);
    });
  });
});
