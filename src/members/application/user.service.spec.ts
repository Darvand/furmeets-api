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
  };
  const repository: UserRepository = {
    getByUUID: jest.fn(),
    save: jest.fn(),
    sync: jest.fn(),
    ...mocks,
  };
  return { repository, ...mocks };
}

describe('UserService.authenticate', () => {
  let repository: ReturnType<typeof createRepository>;
  let service: UserService;

  beforeEach(() => {
    repository = createRepository();
    service = new UserService(repository.repository, {} as TelegramBotService);
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
