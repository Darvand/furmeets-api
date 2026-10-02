import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MEMBERS_PROVIDERS } from "../members.providers";
import { UserEntity } from "../domain/entities/user.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { DuplicateUserError, type UserRepository } from "../domain/services/user.repository";
import { TelegramIdentity } from "../domain/value-objects/telegram-identity.value-object";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";
import { MediaService } from "src/media/application/media.service";
import { MediaKinds } from "src/media/domain/media";

@Injectable()
export class UserService {
    constructor(
        @Inject(MEMBERS_PROVIDERS.UserRepository) private readonly userRepository: UserRepository,
        private readonly telegramBotService: TelegramBotService,
        private readonly mediaService: MediaService,
    ) { }

    async getUserByUUID(uuid: UUID): Promise<UserEntity> {
        const user = await this.userRepository.getByUUID(uuid);
        if (!user) {
            throw new NotFoundException(`User with UUID ${uuid.value} not found`);
        }
        return user;
    }

    async getUserByTelegramId(telegramId: number): Promise<UserEntity | null> {
        const user = await this.userRepository.getByTelegramId(telegramId);
        return user;
    }

    /**
     * Usuario autenticado a partir de su identidad de Telegram. Lo registra en su primer
     * ingreso; si no, refresca nombre y usuario y solo escribe si cambiaron. El caso
     * común (usuario existente sin cambios) es una sola lectura.
     */
    async authenticate(identity: TelegramIdentity): Promise<UserEntity> {
        const user = await this.userRepository.getByTelegramId(identity.telegramId);
        if (!user) {
            return this.register(identity, (id) => UserEntity.registerFromTelegram(id));
        }
        if (user.refreshFrom(identity)) {
            await this.userRepository.updateTelegramProfile(user);
        }
        return user;
    }

    private async register(
        identity: TelegramIdentity,
        build: (identity: TelegramIdentity) => UserEntity,
    ): Promise<UserEntity> {
        try {
            return await this.userRepository.create(build(identity));
        } catch (error) {
            if (!(error instanceof DuplicateUserError)) {
                throw error;
            }
            // Otra petición lo registró primero: se usa ese registro.
            const user = await this.userRepository.getByTelegramId(identity.telegramId);
            if (!user) {
                throw error;
            }
            return user;
        }
    }

    /**
     * Usuario del bot, autor de los mensajes de sistema. Sale de `botInfo` (sin llamar a
     * Telegram tras el arranque); solo se registra la primera vez que hace falta.
     */
    async getBotUser(): Promise<UserEntity> {
        const bot = await this.telegramBotService.getBotInfo();
        const user = await this.userRepository.getByTelegramId(bot.id);
        return user ?? this.register(this.botIdentity(bot), (id) => UserEntity.registerBot(id));
    }

    /** Refresca nombre, usuario y avatar del bot. Pensado para correr en segundo plano. */
    async refreshBotUser(): Promise<void> {
        const user = await this.getBotUser();
        const identity = this.botIdentity(await this.telegramBotService.getBotInfo());
        if (user.refreshFrom(identity)) {
            await this.userRepository.updateTelegramProfile(user);
        }
        await this.refreshAvatar(user);
    }

    /** Toma el avatar actual de Telegram y lo guarda solo si cambió. Pensado para segundo plano. */
    async refreshAvatar(user: UserEntity): Promise<void> {
        const photo = await this.telegramBotService.getProfilePhoto(user.telegramId);
        const avatarMediaId = photo
            ? await this.mediaService.registerTelegramPhoto(MediaKinds.Avatar, photo, user.id.value)
            : undefined;
        if (user.changeAvatar(avatarMediaId)) {
            await this.userRepository.updateAvatar(user);
        }
    }

    /** Guarda la membresía según Telegram, solo si cambió. */
    async updateMembership(user: UserEntity, isMember: boolean): Promise<void> {
        if (user.updateMembership(isMember)) {
            await this.userRepository.updateMembership(user);
        }
    }

    private botIdentity(bot: { id: number; first_name: string; last_name?: string; username?: string }): TelegramIdentity {
        return TelegramIdentity.create({
            telegramId: bot.id,
            firstName: bot.first_name,
            lastName: bot.last_name,
            username: bot.username,
        });
    }
}
