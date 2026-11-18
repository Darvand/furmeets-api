import { MembershipService } from 'src/membership/application/membership.service';
import { Role } from 'src/membership/domain/role';
import { UserEntity } from '../domain/entities/user.entity';
import { GroupRepository } from '../domain/services/group.repository';
import { TelegramIdentity } from '../domain/value-objects/telegram-identity.value-object';
import { GroupsService } from './groups.service';
import { UserService } from './user.service';

const TELEGRAM_DELAY_MS = 2_000;

/** Respuesta de Telegram que tarda 2 s (con timers falsos). */
const slow = <T>(value: T) =>
  new Promise<T>((resolve) =>
    setTimeout(() => resolve(value), TELEGRAM_DELAY_MS),
  );

function setup(storedIsMember = false) {
  const user = UserEntity.registerFromTelegram(
    TelegramIdentity.create({ telegramId: 42, firstName: 'Ana' }),
  );
  user.updateMembership(storedIsMember);

  const groupRepository = {
    getGroup: jest.fn(),
    setMember: jest.fn<Promise<boolean>, [UserEntity, boolean]>(() =>
      Promise.resolve(true),
    ),
    // Refrescar el grupo llama a Telegram: tarda 2 s.
    refreshFromTelegram: jest.fn(() => slow(undefined)),
  };
  const userService = {
    updateMembership: jest.fn<Promise<void>, [UserEntity, boolean]>(() =>
      Promise.resolve(),
    ),
    refreshAvatar: jest.fn(() => slow(undefined)),
  };
  // Rol resuelto (caché, plazo y respaldo viven en MembershipService).
  const resolveRole = jest.fn<Promise<Role>, [UserEntity]>(() =>
    Promise.resolve('member'),
  );

  const service = new GroupsService(
    groupRepository as GroupRepository,
    userService as unknown as UserService,
    { resolveRole } as unknown as MembershipService,
  );
  return { service, user, groupRepository, userService, resolveRole };
}

/** Indica si la promesa ya terminó, sin avanzar los timers. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return settled;
}

describe('GroupsService.sync', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('con el rol en caché no espera a Telegram (fotos y grupo tardan 2 s)', async () => {
    const { service, user, groupRepository, userService } = setup();

    expect(await isSettled(service.sync(user))).toBe(true);

    expect(groupRepository.setMember).toHaveBeenCalledWith(user, true);
    expect(userService.updateMembership).toHaveBeenCalledWith(user, true);
    // Los refrescos arrancaron en segundo plano, pero nadie los esperó.
    expect(groupRepository.refreshFromTelegram).toHaveBeenCalledTimes(1);
    expect(userService.refreshAvatar).toHaveBeenCalledWith(user);
  });

  it('guarda la membresía según el rol resuelto y la devuelve', async () => {
    const { service, user, resolveRole, groupRepository, userService } =
      setup(true);
    resolveRole.mockResolvedValue('applicant');

    expect(await service.sync(user)).toBe(false);

    expect(resolveRole).toHaveBeenCalledWith(user);
    expect(groupRepository.setMember).toHaveBeenCalledWith(user, false);
    expect(userService.updateMembership).toHaveBeenCalledWith(user, false);
  });

  it('refresca grupo y avatar como máximo una vez por TTL', async () => {
    const { service, user, groupRepository, userService } = setup();

    await service.sync(user);
    await service.sync(user);

    expect(groupRepository.refreshFromTelegram).toHaveBeenCalledTimes(1);
    expect(userService.refreshAvatar).toHaveBeenCalledTimes(1);
  });

  it('en el primer arranque (sin grupo en BD) crea el grupo desde Telegram y agrega al miembro', async () => {
    const { service, user, groupRepository } = setup();
    groupRepository.setMember
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const sync = service.sync(user);
    await jest.advanceTimersByTimeAsync(TELEGRAM_DELAY_MS);
    await sync;

    expect(groupRepository.refreshFromTelegram).toHaveBeenCalled();
    expect(groupRepository.setMember).toHaveBeenCalledTimes(2);
  });
});
