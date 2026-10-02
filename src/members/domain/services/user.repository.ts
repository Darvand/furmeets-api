import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { UserEntity } from '../entities/user.entity';

/** Ya existe un usuario con ese `telegramId` (p. ej. dos primeros ingresos simultáneos). */
export class DuplicateUserError extends Error {
  constructor(readonly telegramId: number) {
    super(`User with Telegram ID ${telegramId} already exists`);
    this.name = DuplicateUserError.name;
  }
}

export interface UserRepository {
  getByUUID(uuid: UUID): Promise<UserEntity | null>;
  save(user: UserEntity): Promise<UserEntity>;
  getByTelegramId(telegramId: number): Promise<UserEntity | null>;
  /** Inserta un usuario nuevo. Lanza `DuplicateUserError` si su `telegramId` ya existe. */
  create(user: UserEntity): Promise<UserEntity>;
  /** Persiste solo nombre y usuario de Telegram (ver `UserEntity.refreshFrom`). */
  updateTelegramProfile(user: UserEntity): Promise<void>;
  /** Persiste solo `isMember` (ver `UserEntity.updateMembership`). */
  updateMembership(user: UserEntity): Promise<void>;
  /** Persiste solo el avatar (ver `UserEntity.changeAvatar`). */
  updateAvatar(user: UserEntity): Promise<void>;
}
