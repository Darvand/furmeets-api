import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MEMBERS_PROVIDERS } from "../members.providers";
import { UserEntity } from "../domain/entities/user.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import type { UserRepository } from "../domain/services/user.repository";
import { UserMapper } from "../mappers/user.mapper";
import { CreateUserDto } from "../presentation/dtos/create-user.dto";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";

@Injectable()
export class UserService {
    constructor(
        @Inject(MEMBERS_PROVIDERS.UserRepository) private readonly userRepository: UserRepository,
        private readonly telegramBotService: TelegramBotService,
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

    async createUser(createUserDto: CreateUserDto): Promise<UserEntity> {
        const user = UserMapper.fromDtoToDomain(createUserDto);
        return this.userRepository.save(user);
    }

    async getBotUser(): Promise<UserEntity> {
        const botUser = await this.telegramBotService.getBotMemberFromGroup();
        const bot = await this.userRepository.getByTelegramId(botUser.user.id);
        if (!bot) {
            throw new NotFoundException(`Bot user not found in the database`);
        }
        return bot;
    }

    async createBotUser(): Promise<UserEntity> {
        const botUser = await this.telegramBotService.getBotMemberFromGroup();
        const bot = await this.userRepository.getByTelegramId(botUser.user.id)
        if (bot) {
            return bot;
        }
        const user = UserEntity.create({
            telegramId: botUser.user.id,
            isMember: true,
            username: botUser.user.username!,
            name: botUser.user.first_name + (botUser.user.last_name ? ` ${botUser.user.last_name}` : ''),
            avatarUrl: await this.telegramBotService.getProfilePhotoPath(botUser.user.id),
        })
        return this.userRepository.save(user);
    }
    async sync(telegramId: number): Promise<UserEntity> {
        return this.userRepository.sync(telegramId);
    }
}