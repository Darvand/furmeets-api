import { BadRequestException } from '@nestjs/common';
import type { ChatService } from 'src/chat/application/chat.service';
import type { RequestChatEntity } from 'src/chat/domain/entities/request-chat.entity';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { ApplicationsService } from './applications.service';

const applicant = UserEntity.create({
  name: 'Ana',
  telegramId: 1,
  isMember: false,
});

function setup() {
  const openRequestChat = jest.fn((requestChat: RequestChatEntity) =>
    Promise.resolve({ requestChat, messages: [] }),
  );
  const service = new ApplicationsService({
    openRequestChat,
  } as unknown as ChatService);
  return { service, openRequestChat };
}

describe('ApplicationsService', () => {
  it('abre la solicitud del usuario autenticado con su formulario', async () => {
    const { service, openRequestChat } = setup();

    const { requestChat } = await service.submit(applicant, {
      age: 20,
      city: ' Cali ',
      fursonaName: 'Kiba',
    });

    expect(openRequestChat).toHaveBeenCalledTimes(1);
    expect(requestChat.props.requester).toBe(applicant);
    expect(requestChat.isInProgress()).toBe(true);
    expect(requestChat.props.form?.props).toEqual({
      age: 20,
      city: 'Cali',
      fursonaName: 'Kiba',
    });
  });

  it('un formulario inválido → 400 y no abre nada', async () => {
    const { service, openRequestChat } = setup();

    await expect(
      service.submit(applicant, {
        age: 0,
        city: 'Cali',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(openRequestChat).not.toHaveBeenCalled();
  });
});
