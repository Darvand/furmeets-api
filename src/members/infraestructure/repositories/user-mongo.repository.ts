import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { DuplicateUserError, UserRepository } from "src/members/domain/services/user.repository";
import { User } from "../schemas/user.schema";
import { Model } from "mongoose";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserMapper } from "src/members/mappers/user.mapper";

@Injectable()
export class UserMongoRepository implements UserRepository {

    private readonly logger = new Logger(UserMongoRepository.name);
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<User>,
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

    async create(user: UserEntity): Promise<UserEntity> {
        try {
            await this.userModel.create(UserMapper.toDb(user));
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new DuplicateUserError(user.telegramId);
            }
            throw error;
        }
        return user;
    }

    async updateTelegramProfile(user: UserEntity): Promise<void> {
        await this.userModel.updateOne(
            { _id: user.id.value },
            user.username
                ? { $set: { name: user.name, username: user.username } }
                : { $set: { name: user.name }, $unset: { username: '' } },
        );
    }

    async updateMembership(user: UserEntity): Promise<void> {
        await this.userModel.updateOne({ _id: user.id.value }, { $set: { isMember: user.isMember } });
    }

    async updateAvatar(user: UserEntity): Promise<void> {
        await this.userModel.updateOne(
            { _id: user.id.value },
            user.avatarUrl ? { $set: { avatarUrl: user.avatarUrl } } : { $unset: { avatarUrl: '' } },
        );
    }
}

function isDuplicateKeyError(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === 11000;
}
