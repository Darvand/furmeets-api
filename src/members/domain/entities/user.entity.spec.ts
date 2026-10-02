import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { TelegramIdentity } from '../value-objects/telegram-identity.value-object';
import { Species, UserEntity } from './user.entity';

const identity = (
  overrides: Partial<Parameters<typeof TelegramIdentity.create>[0]> = {},
) =>
  TelegramIdentity.create({
    telegramId: 42,
    firstName: 'Ana',
    lastName: 'Gómez',
    username: 'ana',
    photoUrl: 'https://t.me/i/userpic/320/ana.jpg',
    ...overrides,
  });

describe('UserEntity', () => {
  describe('registerFromTelegram', () => {
    it('crea un no miembro con los datos de Telegram y sin avatar (lo guarda la sincronización)', () => {
      const user = UserEntity.registerFromTelegram(identity());

      expect(user.telegramId).toBe(42);
      expect(user.name).toBe('Ana Gómez');
      expect(user.username).toBe('ana');
      expect(user.avatarMediaId).toBeUndefined();
      expect(user.isMember).toBe(false);
      expect(user.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('refreshFrom', () => {
    const existing = () => {
      const user = UserEntity.create(
        {
          telegramId: 42,
          name: 'Ana Gómez',
          username: 'ana',
          avatarMediaId: 'avatar-del-bot',
          isMember: true,
          birthdate: new Date('2000-01-01'),
        },
        UUID.generate(),
      );
      user.species = Species.Wolf;
      return user;
    };

    it('no reporta cambios si nombre y usuario son iguales', () => {
      expect(existing().refreshFrom(identity())).toBe(false);
    });

    it('toma nombre y usuario de Telegram y reporta el cambio', () => {
      const user = existing();

      const changed = user.refreshFrom(
        identity({
          firstName: 'Anita',
          lastName: undefined,
          username: 'anita',
        }),
      );

      expect(changed).toBe(true);
      expect(user.name).toBe('Anita');
      expect(user.username).toBe('anita');
    });

    it('quita el usuario si en Telegram ya no tiene', () => {
      const user = existing();

      expect(user.refreshFrom(identity({ username: undefined }))).toBe(true);
      expect(user.username).toBeUndefined();
    });

    it('no toca avatar, pertenencia, especie ni fecha de nacimiento', () => {
      const user = existing();

      user.refreshFrom(identity({ firstName: 'Anita', photoUrl: 'otra.jpg' }));

      expect(user.avatarMediaId).toBe('avatar-del-bot');
      expect(user.isMember).toBe(true);
      expect(user.species).toBe(Species.Wolf);
      expect(user.birthdate).toEqual(new Date('2000-01-01'));
    });

    it('rechaza la identidad de otro usuario de Telegram', () => {
      expect(() =>
        existing().refreshFrom(identity({ telegramId: 43 })),
      ).toThrow();
    });
  });

  describe('membresía, avatar y bot', () => {
    it('updateMembership reporta solo cambios', () => {
      const user = UserEntity.registerFromTelegram(identity());

      expect(user.updateMembership(false)).toBe(false);
      expect(user.updateMembership(true)).toBe(true);
      expect(user.isMember).toBe(true);
    });

    it('changeAvatar reemplaza o quita el avatar y reporta solo cambios', () => {
      const user = UserEntity.registerFromTelegram(identity());

      expect(user.changeAvatar('media-a')).toBe(true);
      expect(user.changeAvatar('media-a')).toBe(false);
      expect(user.changeAvatar(undefined)).toBe(true);
      expect(user.avatarMediaId).toBeUndefined();
    });

    it('registerBot crea al bot como miembro', () => {
      const bot = UserEntity.registerBot(
        identity({ telegramId: 999, firstName: 'FurBot', lastName: undefined }),
      );

      expect(bot.isMember).toBe(true);
      expect(bot.name).toBe('FurBot');
    });
  });
});
