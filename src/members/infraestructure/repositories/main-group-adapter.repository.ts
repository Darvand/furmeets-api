import { Inject, Injectable, Logger } from "@nestjs/common";
import { MainGroupRepository } from "../../domain/services/main-group.repository";
import { InjectModel } from "@nestjs/mongoose";
import { MainGroup } from "../schemas/main-group.schema";
import { Model } from "mongoose";
import { GroupMapper } from "src/members/mappers/group.mapper";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";
import telegramBotConfig from "src/telegram-bot/telegram-bot.config";
import type { ConfigType } from "@nestjs/config";
import { MemberMapper } from "src/members/mappers/member.mapper";
import { GroupMember } from "src/members/domain/entities/group-member.entity";
import { MainGroupAggregate } from "src/members/domain/entities/main-group-aggregate.entity";

@Injectable()
export class MainGroupAdapterRepository implements MainGroupRepository {
    private readonly logger = new Logger(MainGroupAdapterRepository.name);

    constructor(
        @InjectModel(MainGroup.name) private readonly mainGroupModel: Model<MainGroup>,
        private readonly telegramBotService: TelegramBotService,
        @Inject(telegramBotConfig.KEY)
        private readonly config: ConfigType<typeof telegramBotConfig>
    ) { }
    getGroup(): Promise<MainGroupAggregate | null> {
        throw new Error("Method not implemented.");
    }
    syncMember(member: GroupMember): Promise<void> {
        throw new Error("Method not implemented.");
    }
    // async findMemberByTelegramId(memberId: number) {
    //     const group = await this.mainGroupModel.findOne({ telegramId: this.config.mainChatId }).exec();
    //     if (!group) {
    //         return null;
    //     }
    //     const groupDomain = GroupMapper.toDomain(group);
    //     const member = groupDomain.getMember(memberId);
    //     if (member) {
    //         return member;
    //     }
    //     const telegramMember = await this.telegramBotService.getMemberFromMainChat(memberId);
    //     this.logger.debug(`Fetched member from Telegram: ${JSON.stringify(telegramMember)}`);
    //     if (telegramMember && telegramMember.user) {

    //         const member = MemberMapper.toDomain(telegramMember.user);
    //         groupDomain.addMember(member);
    //         await this.mainGroupModel.updateOne({ telegramId: this.config.mainChatId }, { members: groupDomain.members });
    //         return member;
    //     }
    //     return null;
    // }
}