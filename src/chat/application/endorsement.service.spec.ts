import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import type { Endorsement } from 'src/review/domain/endorsement';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type {
  ChatRepository,
  RequestChatHeader,
} from '../domain/services/chat.repository';
import type { RequestChatStateType } from '../domain/value-objects/request-chat-state.value-object';
import type { ChatGateway } from '../presentation/chat.gateway';
import { EndorsementService } from './endorsement.service';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

const requester = user(1);
const member = user(2);
const requestChatId = UUID.generate();

function setup(state: RequestChatStateType = 'InProgress') {
  const stored: Endorsement[] = [
    { endorser: member, at: new Date('2026-10-05T12:00:00Z') },
  ];
  const header: RequestChatHeader = {
    id: requestChatId,
    requesterId: requester.id,
    state,
  };
  const chats = {
    endorse: jest.fn(() => Promise.resolve<Endorsement[] | null>(stored)),
    withdrawEndorsement: jest.fn(() =>
      Promise.resolve<Endorsement[] | null>([]),
    ),
    findHeader: jest.fn(() =>
      Promise.resolve<RequestChatHeader | null>(header),
    ),
  };
  const gateway = { emitEndorsements: jest.fn() };
  const service = new EndorsementService(
    chats as unknown as ChatRepository,
    gateway as unknown as ChatGateway,
  );
  return { service, chats, gateway, stored };
}

describe('EndorsementService', () => {
  it('avala con una operación atómica, responde los avales y los emite a los miembros', async () => {
    const { service, chats, gateway, stored } = setup();

    const result = await service.endorse(requestChatId, member);

    expect(chats.endorse).toHaveBeenCalledWith(
      requestChatId,
      member.id,
      expect.any(Date),
    );
    expect(chats.findHeader).not.toHaveBeenCalled();
    expect(result).toEqual({ requestChatId, endorsements: stored });
    expect(gateway.emitEndorsements).toHaveBeenCalledWith(result);
  });

  it('retirar el aval responde y emite los avales que quedan', async () => {
    const { service, chats, gateway } = setup();

    const result = await service.withdraw(requestChatId, member);

    expect(chats.withdrawEndorsement).toHaveBeenCalledWith(
      requestChatId,
      member.id,
    );
    expect(result.endorsements).toEqual([]);
    expect(gateway.emitEndorsements).toHaveBeenCalledWith(result);
  });

  it('avalar la propia solicitud → 403, aunque ya sea miembro', async () => {
    const { service, chats, gateway } = setup();
    chats.endorse.mockResolvedValue(null);

    await expect(
      service.endorse(requestChatId, requester),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(gateway.emitEndorsements).not.toHaveBeenCalled();
  });

  it.each(['Approved', 'Rejected'] as const)(
    'con la solicitud %s, avalar o retirar → 409',
    async (state) => {
      const { service, chats } = setup(state);
      chats.endorse.mockResolvedValue(null);
      chats.withdrawEndorsement.mockResolvedValue(null);

      await expect(
        service.endorse(requestChatId, member),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.withdraw(requestChatId, member),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );

  it('si la solicitud no existe → 404', async () => {
    const { service, chats } = setup();
    chats.endorse.mockResolvedValue(null);
    chats.findHeader.mockResolvedValue(null);

    await expect(service.endorse(requestChatId, member)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
