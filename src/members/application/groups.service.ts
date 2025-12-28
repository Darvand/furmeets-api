import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { GroupMember } from "../domain/entities/group-member.entity";
import { MEMBERS_PROVIDERS } from "../members.providers";
import type { GroupRepository } from "../domain/services/group.repository";
import { MainGroupAggregate } from "../domain/entities/main-group-aggregate.entity";
import { GroupDto } from "../presentation/dtos/group.dto";
import { GroupMapper } from "../mappers/group.mapper";
import { GetGroupDto } from "../presentation/dtos/get-group.dto";
import { GroupEntity } from "../domain/entities/group.entity";
import { UserService } from "./user.service";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";

@Injectable()
export class GroupsService {

    private readonly logger = new Logger(GroupsService.name);

    constructor(
        @Inject(MEMBERS_PROVIDERS.GroupRepository) private readonly groupRepository: GroupRepository,
        private readonly userService: UserService,
        private readonly telegramBotService: TelegramBotService,
    ) { }

    async getGroup(): Promise<GroupEntity> {
        const group = await this.groupRepository.getGroup();
        if (!group) {
            throw new NotFoundException(`Group not found`);
        }
        return group;
    }

    async saveGroup(group: GroupEntity): Promise<GroupEntity> {
        return this.groupRepository.save(group);
    }

    async sync(userTelegramId: number): Promise<void> {
        const group = await this.groupRepository.sync();
        const user = await this.userService.sync(userTelegramId);
        if (user.isMember && !group.hasMember(user)) {
            group.addMember(user);
            await this.saveGroup(group);
            this.logger.debug(`Added user with Telegram ID ${userTelegramId} to the group.`);
        }
        if (!user.isMember && group.hasMember(user)) {
            this.logger.debug(`User with Telegram ID ${userTelegramId} is no longer a member of the group.`);
            group.removeMember(user);
            await this.saveGroup(group);
        }
        await this.userService.createBotUser();
    }
}