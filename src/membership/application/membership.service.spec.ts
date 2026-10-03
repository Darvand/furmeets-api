import { ChatMemberStatus } from '../domain/role';
import { TelegramMembershipPort } from '../domain/telegram-membership.port';
import {
  MEMBERSHIP_DEADLINE_MS,
  MEMBERSHIP_TTL_MS,
  MembershipService,
} from './membership.service';

function setup(status = 'member') {
  const getChatMember = jest.fn<Promise<ChatMemberStatus>, [number]>(() =>
    Promise.resolve({ status }),
  );
  const telegram: TelegramMembershipPort = { getChatMember };
  return { service: new MembershipService(telegram), getChatMember };
}

describe('MembershipService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resuelve el rol según Telegram', async () => {
    expect(await setup('member').service.getRole(1)).toBe('member');
    expect(await setup('left').service.getRole(1)).toBe('applicant');
  });

  it('dos consultas dentro de 10 min hacen una sola llamada a Telegram', async () => {
    const { service, getChatMember } = setup();

    await service.getRole(1);
    jest.advanceTimersByTime(MEMBERSHIP_TTL_MS - 1);
    await service.getRole(1);

    expect(getChatMember).toHaveBeenCalledTimes(1);
  });

  it('pasados 10 min vuelve a consultar', async () => {
    const { service, getChatMember } = setup();

    await service.getRole(1);
    jest.advanceTimersByTime(MEMBERSHIP_TTL_MS);
    await service.getRole(1);

    expect(getChatMember).toHaveBeenCalledTimes(2);
  });

  it('consultas simultáneas comparten una sola llamada', async () => {
    const { service, getChatMember } = setup();

    await Promise.all([service.getRole(1), service.getRole(1)]);

    expect(getChatMember).toHaveBeenCalledTimes(1);
  });

  it('invalidate hace que la siguiente consulta refleje el rol nuevo', async () => {
    const { service, getChatMember } = setup('member');
    expect(await service.getRole(1)).toBe('member');

    getChatMember.mockResolvedValue({ status: 'kicked' });
    expect(await service.getRole(1)).toBe('member');
    service.invalidate(1);

    expect(await service.getRole(1)).toBe('applicant');
  });

  it('invalidar a un usuario no afecta a los demás', async () => {
    const { service, getChatMember } = setup();
    await service.getRole(1);
    await service.getRole(2);

    service.invalidate(1);
    await service.getRole(2);

    expect(getChatMember).toHaveBeenCalledTimes(2);
  });

  it('no guarda en caché los errores de Telegram', async () => {
    const { service, getChatMember } = setup();
    getChatMember.mockRejectedValueOnce(new Error('caído'));

    await expect(service.getRole(1)).rejects.toThrow('caído');
    expect(await service.getRole(1)).toBe('member');
  });

  describe('resolveRole', () => {
    it('con la caché fría espera a Telegram como máximo el plazo y usa la guardada', async () => {
      const { service, getChatMember } = setup();
      getChatMember.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ status: 'left' }), 2_000),
          ),
      );

      const role = service.resolveRole({ telegramId: 1, isMember: true });
      jest.advanceTimersByTime(MEMBERSHIP_DEADLINE_MS);

      expect(await role).toBe('member');
    });

    it('si Telegram falla, usa la membresía guardada', async () => {
      const { service, getChatMember } = setup();
      getChatMember.mockRejectedValue(new Error('caído'));

      expect(
        await service.resolveRole({ telegramId: 1, isMember: false }),
      ).toBe('applicant');
    });

    it('si Telegram responde, usa su rol aunque la BD diga otra cosa', async () => {
      const { service } = setup('kicked');

      expect(await service.resolveRole({ telegramId: 1, isMember: true })).toBe(
        'applicant',
      );
    });
  });

  it('avisa a los interesados cuando invalida un rol', () => {
    const { service } = setup();
    const listener = jest.fn();
    service.onInvalidate(listener);

    service.invalidate(7);

    expect(listener).toHaveBeenCalledWith(7);
  });
});
