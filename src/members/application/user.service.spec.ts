import { MediaService } from 'src/media/application/media.service';
import { MediaKinds } from 'src/media/domain/media';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { UserEntity } from '../domain/entities/user.entity';
import {
  DuplicateUserError,
  UserRepository,
} from '../domain/services/user.repository';
import { TelegramIdentity } from '../domain/value-objects/telegram-identity.value-object';
import { UserService } from './user.service';

const identity = TelegramIdentity.create({
  telegramId: 42,
  firstName: 'Ana',
  username: 'ana',
});

function createRepository() {
  const mocks = {
    getByTelegramId: jest.fn<Promise<UserEntity | null>, [number]>(),
    create: jest.fn((user: UserEntity) => Promise.resolve(user)),
    updateTelegramProfile: jest.fn<Promise<void>, [UserEntity]>(() =>
      Promise.resolve(),
    ),
    updateMembership: jest.fn<Promise<void>, [UserEntity]>(() =>
      Promise.resolve(),
    ),
    updateAvatar: jest.fn<Promise<void>, [UserEntity]>(() => Promise.resolve()),
  };
  const repository: UserRepository = {
    getByUUID: jest.fn(),
    save: jest.fn(),
    ...mocks,
  };
  return { repository, ...mocks };
}

describe('UserService.authenticate', () => {
  let repository: ReturnType<typeof createRepository>;
  let service: UserService;

  beforeEach(() => {
    repository = createRepository();
    service = new UserService(
      repository.repository,
      {} as TelegramBotService,
      {} as MediaService,
    );
  });

  it('usuario existente sin cambios: una sola lectura, sin escrituras', async () => {
    const stored = UserEntity.registerFromTelegram(identity);
    repository.getByTelegramId.mockResolvedValue(stored);

    const user = await service.authenticate(identity);

    expect(user).toBe(stored);
    expect(repository.getByTelegramId).toHaveBeenCalledTimes(1);
    expect(repository.updateTelegramProfile).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('usuario existente con otro nombre: actualiza solo su perfil de Telegram', async () => {
    const stored = UserEntity.registerFromTelegram(
      TelegramIdentity.create({ telegramId: 42, firstName: 'Antes' }),
    );
    repository.getByTelegramId.mockResolvedValue(stored);

    const user = await service.authenticate(identity);

    expect(user.name).toBe('Ana');
    expect(repository.updateTelegramProfile).toHaveBeenCalledWith(stored);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('primer ingreso: registra al usuario como no miembro', async () => {
    repository.getByTelegramId.mockResolvedValue(null);

    const user = await service.authenticate(identity);

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(user.telegramId).toBe(42);
    expect(user.isMember).toBe(false);
  });

  it('dos primeros ingresos simultáneos: el perdedor usa el registro del ganador', async () => {
    const winner = UserEntity.registerFromTelegram(identity);
    repository.getByTelegramId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    repository.create.mockRejectedValue(new DuplicateUserError(42));

    const user = await service.authenticate(identity);

    expect(user).toBe(winner);
    expect(repository.getByTelegramId).toHaveBeenCalledTimes(2);
  });

  it('propaga cualquier otro error al registrar', async () => {
    repository.getByTelegramId.mockResolvedValue(null);
    repository.create.mockRejectedValue(new Error('mongo caído'));

    await expect(service.authenticate(identity)).rejects.toThrow('mongo caído');
  });
});

const BOT = { id: 999, is_bot: true, first_name: 'FurBot', username: 'furbot' };

describe('UserService (Telegram en segundo plano)', () => {
  let repository: ReturnType<typeof createRepository>;
  let telegram: {
    getBotInfo: jest.Mock;
    getProfilePhoto: jest.Mock;
  };
  let media: { registerTelegramPhoto: jest.Mock };
  let service: UserService;

  beforeEach(() => {
    repository = createRepository();
    telegram = {
      getBotInfo: jest.fn().mockResolvedValue(BOT),
      getProfilePhoto: jest
        .fn()
        .mockResolvedValue({ file_id: 'f160', file_unique_id: 'u160' }),
    };
    media = { registerTelegramPhoto: jest.fn().mockResolvedValue('media-1') };
    service = new UserService(
      repository.repository,
      telegram as unknown as TelegramBotService,
      media as unknown as MediaService,
    );
  });

  it('getBotUser usa botInfo y la BD, sin pedir fotos a Telegram', async () => {
    const bot = UserEntity.registerBot(
      TelegramIdentity.create({ telegramId: 999, firstName: 'FurBot' }),
    );
    repository.getByTelegramId.mockResolvedValue(bot);

    expect(await service.getBotUser()).toBe(bot);
    expect(repository.getByTelegramId).toHaveBeenCalledWith(999);
    expect(telegram.getProfilePhoto).not.toHaveBeenCalled();
  });

  it('getBotUser registra al bot como miembro si no existe', async () => {
    repository.getByTelegramId.mockResolvedValue(null);

    const bot = await service.getBotUser();

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(bot).toMatchObject({
      telegramId: 999,
      name: 'FurBot',
      isMember: true,
    });
  });

  it('refreshAvatar registra la foto en media y guarda su id solo si cambió', async () => {
    const user = UserEntity.registerFromTelegram(identity);

    await service.refreshAvatar(user);
    await service.refreshAvatar(user);

    expect(media.registerTelegramPhoto).toHaveBeenCalledWith(
      MediaKinds.Avatar,
      { file_id: 'f160', file_unique_id: 'u160' },
      user.id.value,
    );
    expect(user.avatarMediaId).toBe('media-1');
    expect(repository.updateAvatar).toHaveBeenCalledTimes(1);
  });

  it('refreshAvatar sin foto de perfil quita el avatar sin registrar nada', async () => {
    const user = UserEntity.registerFromTelegram(identity);
    user.changeAvatar('media-viejo');
    telegram.getProfilePhoto.mockResolvedValue(undefined);

    await service.refreshAvatar(user);

    expect(media.registerTelegramPhoto).not.toHaveBeenCalled();
    expect(user.avatarMediaId).toBeUndefined();
    expect(repository.updateAvatar).toHaveBeenCalledTimes(1);
  });

  it('updateMembership guarda solo si cambió', async () => {
    const user = UserEntity.registerFromTelegram(identity);

    await service.updateMembership(user, false);
    await service.updateMembership(user, true);

    expect(repository.updateMembership).toHaveBeenCalledTimes(1);
    expect(user.isMember).toBe(true);
  });

  it('refreshBotUser actualiza nombre y avatar del bot', async () => {
    const bot = UserEntity.registerBot(
      TelegramIdentity.create({ telegramId: 999, firstName: 'Viejo' }),
    );
    repository.getByTelegramId.mockResolvedValue(bot);

    await service.refreshBotUser();

    expect(bot.name).toBe('FurBot');
    expect(repository.updateTelegramProfile).toHaveBeenCalledWith(bot);
    expect(repository.updateAvatar).toHaveBeenCalledWith(bot);
  });
});
