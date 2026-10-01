import { MembershipService } from 'src/membership/application/membership.service';
import { Role } from 'src/membership/domain/role';
import { UserEntity } from '../domain/entities/user.entity';
import { GroupRepository } from '../domain/services/group.repository';
import { TelegramIdentity } from '../domain/value-objects/telegram-identity.value-object';
import { GroupsService, MEMBERSHIP_DEADLINE_MS } from './groups.service';
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
    refreshBotUser: jest.fn(() => slow(undefined)),
    refreshAvatar: jest.fn(() => slow(undefined)),
  };
  // Rol según Telegram: con la caché caliente responde al instante.
  const getRole = jest.fn<Promise<Role>, [number]>(() =>
    Promise.resolve('member'),
  );

  const service = new GroupsService(
    groupRepository as GroupRepository,
    userService as unknown as UserService,
    { getRole } as unknown as MembershipService,
  );
  return { service, user, groupRepository, userService, getRole };
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

  it('con el rol en caché no espera a Telegram (fotos, grupo y bot tardan 2 s)', async () => {
    const { service, user, groupRepository, userService } = setup();

    expect(await isSettled(service.sync(user))).toBe(true);

    expect(groupRepository.setMember).toHaveBeenCalledWith(user, true);
    expect(userService.updateMembership).toHaveBeenCalledWith(user, true);
    // Los refrescos arrancaron en segundo plano, pero nadie los esperó.
    expect(groupRepository.refreshFromTelegram).toHaveBeenCalledTimes(1);
    expect(userService.refreshAvatar).toHaveBeenCalledWith(user);
    expect(userService.refreshBotUser).toHaveBeenCalledTimes(1);
  });

  it('si la membresía tarda, espera como máximo el plazo y usa la guardada', async () => {
    const { service, user, getRole, groupRepository } = setup(true);
    getRole.mockImplementation(() => slow<Role>('applicant'));

    const sync = service.sync(user);
    expect(await isSettled(sync)).toBe(false);
    jest.advanceTimersByTime(MEMBERSHIP_DEADLINE_MS);
    await sync;

    expect(groupRepository.setMember).toHaveBeenCalledWith(user, true);
  });

  it('si Telegram falla, usa la membresía guardada', async () => {
    const { service, user, getRole, groupRepository } = setup(false);
    getRole.mockRejectedValue(new Error('Telegram caído'));

    await service.sync(user);

    expect(groupRepository.setMember).toHaveBeenCalledWith(user, false);
  });

  it('refresca grupo, bot y avatar como máximo una vez por TTL', async () => {
    const { service, user, groupRepository, userService } = setup();

    await service.sync(user);
    await service.sync(user);

    expect(groupRepository.refreshFromTelegram).toHaveBeenCalledTimes(1);
    expect(userService.refreshBotUser).toHaveBeenCalledTimes(1);
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
