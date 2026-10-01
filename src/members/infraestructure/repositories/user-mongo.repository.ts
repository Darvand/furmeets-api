import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { TelegramProfile, UserRepository } from "src/members/domain/services/user.repository";
import { User } from "../schemas/user.schema";
import { Model, UpdateQuery } from "mongoose";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserMapper } from "src/members/mappers/user.mapper";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";
import telegramBotConfig from "src/telegram-bot/telegram-bot.config";
import type { ConfigType } from "@nestjs/config";

@Injectable()
export class UserMongoRepository implements UserRepository {

    private readonly logger = new Logger(UserMongoRepository.name);
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<User>,
        private readonly telegramBotService: TelegramBotService,
        @Inject(telegramBotConfig.KEY) private readonly config: ConfigType<typeof telegramBotConfig>
    ) { }

    async getByUUID(uuid: UUID): Promise<UserEntity | null> {
        Logger.debug(`Fetching user with ID: ${uuid.value}`);
        const userDoc = await this.userModel.findOne({ _id: uuid.value }).lean<User>().exec();
        if (!userDoc) {
            return null;
        }
        return UserMapper.fromDb(userDoc);
    }

    async save(user: UserEntity): Promise<UserEntity> {
        const dbUser = UserMapper.toDb(user);
        this.logger.debug(`Saving user with ID: ${dbUser._id}`);
        this.logger.debug(`User data: ${JSON.stringify(dbUser)}`);
        await this.userModel.updateOne({ _id: dbUser._id }, dbUser, { upsert: true });
        return user;
    }

    async getByTelegramId(telegramId: number): Promise<UserEntity | null> {
        this.logger.debug(`Fetching user with Telegram ID: ${telegramId}`);
        const userDoc = await this.userModel.findOne({ telegramId }).lean<User>().exec();
        if (!userDoc) {
            return null;
        }
        return UserMapper.fromDb(userDoc);
    }

    /**
     * Crea o actualiza al usuario con los datos firmados de `initData` en una sola
     * operación. Nombre y usuario se refrescan siempre; el avatar solo se usa al crear
     * (la sincronización con el bot guarda uno propio). `isMember`, especie y fecha de
     * nacimiento no se tocan.
     */
    async upsertFromTelegram(profile: TelegramProfile): Promise<UserEntity> {
        const update: UpdateQuery<User> = {
            $set: { name: profile.name },
            $setOnInsert: {
                _id: UUID.generate().value,
                telegramId: profile.telegramId,
                isMember: false,
                createdAt: new Date(),
                ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
            },
        };
        if (profile.username) {
            update.$set!.username = profile.username;
        } else {
            update.$unset = { username: '' };
        }
        const userDoc = await this.userModel
            .findOneAndUpdate({ telegramId: profile.telegramId }, update, {
                upsert: true,
                new: true,
                setDefaultsOnInsert: false,
            })
            .lean<User>()
            .exec();
        return UserMapper.fromDb(userDoc);
    }

    async sync(telegramId: number): Promise<UserEntity> {
        const dbUser = await this.getByTelegramId(telegramId);
        const telegramUser = await this.telegramBotService.getMemberFromGroup(telegramId);
        this.logger.debug(`Fetched Telegram user: ${JSON.stringify(telegramUser)}`);
        this.logger.debug(`User is member: ${telegramUser ? (telegramUser.status !== 'left' && telegramUser.status !== 'kicked') : false}`);
        const updatedUser = UserEntity.create({
            telegramId: telegramUser.user.id,
            isMember: telegramUser ? (telegramUser.status !== 'left' && telegramUser.status !== 'kicked') : false,
            username: telegramUser.user.username || '',
            name: telegramUser.user.first_name + (telegramUser.user.last_name ? ` ${telegramUser.user.last_name}` : ''),
            avatarUrl: await this.telegramBotService.getProfilePhotoPath(telegramUser.user.id),
        }, dbUser ? dbUser.id : UUID.generate());
        this.logger.debug(`Syncing user with Telegram ID: ${telegramId}`);
        return this.save(updatedUser);
    }
}