import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'stream';
import type { MembershipService } from 'src/membership/application/membership.service';
import { Roles, type Role } from 'src/membership/domain/role';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { TelegramIdentity } from 'src/members/domain/value-objects/telegram-identity.value-object';
import { StorageNotConfiguredError } from 'src/telegram-bot/telegram-bot.service';
import { MediaKinds, type MediaItem } from '../domain/media';
import type { MediaStorage } from '../domain/media-storage.port';
import type { MediaRepository } from '../domain/media.repository';
import { MediaService } from './media.service';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PHOTO = { file_id: 'file-1', file_unique_id: 'unique-1' };

const user = (telegramId: number) =>
  UserEntity.registerFromTelegram(
    TelegramIdentity.create({ telegramId, firstName: 'Ana' }),
  );

function setup(role: Role = Roles.Applicant) {
  const stored = new Map<string, MediaItem>();
  // Funciones sueltas (no métodos) para poder pasarlas a `expect`.
  const repository = {
    findById: jest.fn((id: string) => Promise.resolve(stored.get(id) ?? null)),
    findByIds: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.flatMap((id) => (stored.has(id) ? [stored.get(id)!] : [])),
      ),
    ),
    create: jest.fn((media: MediaItem) => {
      stored.set(media.id, media);
      return Promise.resolve();
    }),
    registerOnce: jest.fn(() => Promise.resolve('media-existente')),
    shareWith: jest.fn((ids: readonly string[], userId: string) => {
      for (const id of ids) {
        const media = stored.get(id);
        if (media) {
          media.sharedWith = [...(media.sharedWith ?? []), userId];
        }
      }
      return Promise.resolve();
    }),
  };
  const storage = {
    upload: jest.fn().mockResolvedValue(PHOTO),
    open: jest.fn(() =>
      Promise.resolve({ body: Readable.from(['bytes']), length: 5 }),
    ),
  };
  const resolveRole = jest.fn().mockResolvedValue(role);
  const service = new MediaService(
    repository as MediaRepository,
    storage as MediaStorage,
    { resolveRole } as unknown as MembershipService,
  );
  return { service, repository, storage, stored, resolveRole };
}

describe('MediaService', () => {
  describe('upload', () => {
    it('sube la imagen y guarda file_id, file_unique_id y dueño', async () => {
      const { service, storage, stored } = setup();
      const owner = user(1);

      const id = await service.upload(owner, JPEG);

      expect(storage.upload).toHaveBeenCalledWith(JPEG);
      expect(stored.get(id)).toEqual({
        id,
        kind: MediaKinds.Upload,
        fileId: 'file-1',
        fileUniqueId: 'unique-1',
        ownerId: owner.id.value,
        mimeType: 'image/jpeg',
      });
    });

    it('rechaza lo que no es JPEG, PNG ni WebP sin llamar a Telegram', async () => {
      const { service, storage } = setup();

      await expect(
        service.upload(user(1), Buffer.from('GIF89a')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('sin canal de almacenamiento responde 503', async () => {
      const { service, storage, repository } = setup();
      storage.upload.mockRejectedValue(new StorageNotConfiguredError());

      await expect(service.upload(user(1), JPEG)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  it('registerTelegramPhoto registra una sola vez por archivo', async () => {
    const { service, repository } = setup();

    const id = await service.registerTelegramPhoto(
      MediaKinds.Avatar,
      PHOTO,
      'user-1',
    );

    expect(id).toBe('media-existente');
    expect(repository.registerOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: MediaKinds.Avatar,
        fileId: 'file-1',
        fileUniqueId: 'unique-1',
        ownerId: 'user-1',
      }),
    );
  });

  describe('open', () => {
    it('id inexistente → 404 sin llamar a Telegram', async () => {
      const { service, storage } = setup();

      await expect(service.open(user(1), 'nada')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(storage.open).not.toHaveBeenCalled();
    });

    it('quien la subió la ve sin consultar su rol', async () => {
      const { service, storage, resolveRole } = setup();
      const owner = user(1);
      const id = await service.upload(owner, JPEG);

      const media = await service.open(owner, id);

      expect(media).toMatchObject({ mimeType: 'image/jpeg', length: 5 });
      expect(storage.open).toHaveBeenCalledWith('file-1');
      expect(resolveRole).not.toHaveBeenCalled();
    });

    it('otro solicitante → 403 sin descargar nada', async () => {
      const { service, storage } = setup(Roles.Applicant);
      const id = await service.upload(user(1), JPEG);

      await expect(service.open(user(2), id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(storage.open).not.toHaveBeenCalled();
    });

    it('un miembro ve la imagen de otro', async () => {
      const { service } = setup(Roles.Member);
      const id = await service.upload(user(1), JPEG);

      await expect(service.open(user(2), id)).resolves.toMatchObject({
        mimeType: 'image/jpeg',
      });
    });
  });

  describe('shareUploads', () => {
    it('quien recibe la imagen compartida la puede abrir sin ser miembro', async () => {
      const { service } = setup(Roles.Applicant);
      const member = user(1);
      const applicant = user(2);
      const id = await service.upload(member, JPEG);
      await expect(service.open(applicant, id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      await service.shareUploads([id], applicant.id.value);

      await expect(service.open(applicant, id)).resolves.toMatchObject({
        mimeType: 'image/jpeg',
      });
    });

    it('sin imágenes no escribe nada', async () => {
      const { service, repository } = setup();

      await service.shareUploads([], user(2).id.value);

      expect(repository.shareWith).not.toHaveBeenCalled();
    });
  });

  describe('assertOwnUploads', () => {
    it('acepta imágenes que subió el mismo usuario', async () => {
      const { service } = setup();
      const owner = user(1);
      const ids = [
        await service.upload(owner, JPEG),
        await service.upload(owner, JPEG),
      ];

      await expect(service.assertOwnUploads(owner, ids)).resolves.toBe(
        undefined,
      );
    });

    it('una imagen que no existe → 400', async () => {
      const { service } = setup();
      const owner = user(1);
      const mine = await service.upload(owner, JPEG);

      await expect(
        service.assertOwnUploads(owner, [mine, 'no-existe']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una imagen subida por otro usuario → 400', async () => {
      const { service } = setup();
      const other = await service.upload(user(2), JPEG);

      await expect(
        service.assertOwnUploads(user(1), [other]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un avatar, aunque sea propio, no es una subida → 400', async () => {
      const { service, stored } = setup();
      const owner = user(1);
      stored.set('avatar-1', {
        id: 'avatar-1',
        kind: MediaKinds.Avatar,
        fileId: 'f',
        fileUniqueId: 'u',
        ownerId: owner.id.value,
        mimeType: 'image/jpeg',
      });

      await expect(
        service.assertOwnUploads(owner, ['avatar-1']),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sin imágenes no consulta nada', async () => {
      const { service, repository } = setup();

      await service.assertOwnUploads(user(1), []);

      expect(repository.findByIds).not.toHaveBeenCalled();
    });
  });
});
