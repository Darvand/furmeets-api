import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserEntity } from "../entities/user.entity";

/** Datos del usuario que Telegram firma en `initData`. */
export interface TelegramProfile {
    telegramId: number;
    name: string;
    username?: string;
    avatarUrl?: string;
}

export interface UserRepository {
    getByUUID(uuid: UUID): Promise<UserEntity | null>;
    save(user: UserEntity): Promise<UserEntity>;
    getByTelegramId(telegramId: number): Promise<UserEntity | null>;
    sync(telegramId: number): Promise<UserEntity>;
    upsertFromTelegram(profile: TelegramProfile): Promise<UserEntity>;
}