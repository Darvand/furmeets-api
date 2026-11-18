import { BadRequestException } from '@nestjs/common';
import type { ChatService } from 'src/chat/application/chat.service';
import type { RequestChatEntity } from 'src/chat/domain/entities/request-chat.entity';
import type { MediaService } from 'src/media/application/media.service';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { ApplicationsService } from './applications.service';

const applicant = UserEntity.create({
  name: 'Ana',
  telegramId: 1,
  isMember: false,
});

function setup({ imagesAreOwn = true } = {}) {
  const openRequestChat = jest.fn((requestChat: RequestChatEntity) =>
    Promise.resolve({ requestChat, messages: [] }),
  );
  const assertOwnUploads = jest.fn(() =>
    imagesAreOwn
      ? Promise.resolve()
      : Promise.reject(new BadRequestException('not your image')),
  );
  const service = new ApplicationsService(
    { openRequestChat } as unknown as ChatService,
    { assertOwnUploads } as unknown as MediaService,
  );
  return { service, openRequestChat, assertOwnUploads };
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

  it('las imágenes deben ser subidas del propio solicitante', async () => {
    const { service, assertOwnUploads } = setup();

    const { requestChat } = await service.submit(applicant, {
      age: 20,
      city: 'Cali',
      imageIds: ['img-1', 'img-2'],
    });

    expect(assertOwnUploads).toHaveBeenCalledWith(applicant, [
      'img-1',
      'img-2',
    ]);
    expect(requestChat.props.form?.props.imageIds).toEqual(['img-1', 'img-2']);
  });

  it('con una imagen ajena → 400 y no abre nada', async () => {
    const { service, openRequestChat } = setup({ imagesAreOwn: false });

    await expect(
      service.submit(applicant, {
        age: 20,
        city: 'Cali',
        imageIds: ['ajena'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(openRequestChat).not.toHaveBeenCalled();
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
