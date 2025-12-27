import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { GroupRepository } from "../../domain/services/group.repository";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { TelegramBotService } from "src/telegram-bot/telegram-bot.service";
import telegramBotConfig from "src/telegram-bot/telegram-bot.config";
import type { ConfigType } from "@nestjs/config";
import { Group } from "../schemas/group.schema";
import { GroupEntity } from "src/members/domain/entities/group.entity";
import { GroupMapper } from "src/members/mappers/group.mapper";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";

@Injectable()
export class GroupAdapterRepository implements GroupRepository {
    private readonly logger = new Logger(GroupAdapterRepository.name);

    constructor(
        @InjectModel(Group.name) private readonly groupModel: Model<Group>,
        private readonly telegramBotService: TelegramBotService,
        @Inject(telegramBotConfig.KEY)
        private readonly config: ConfigType<typeof telegramBotConfig>
    ) { }

    async getGroup(): Promise<GroupEntity> {
        const groupDoc = await this.groupModel
            .findOne({ telegramId: this.config.mainChatId })
            .populate('members')
            .exec();
        if (groupDoc) {
            return GroupMapper.fromDbToDomain(groupDoc);
        }
        throw new NotFoundException("Group not found in database");

    }

    async save(group: GroupEntity): Promise<GroupEntity> {
        const dbGroup = GroupMapper.toPersistence(group);
        this.logger.debug(`Saving group with ID: ${dbGroup._id}`);
        await this.groupModel.updateOne({ _id: dbGroup._id }, dbGroup, { upsert: true });
        return group;
    }

    async sync(): Promise<GroupEntity> {
        const groupDoc = await this.groupModel
            .findOne({ telegramId: this.config.mainChatId })
            .populate('members')
            .exec();
        const telegramGroup = await this.telegramBotService.getGroup();
        if (!telegramGroup) {
            throw new NotFoundException("Group could not be fetched from Telegram");
        }
        const telegramGroupPhotoPath = telegramGroup.photo
            ? await this.telegramBotService.getProfilePhotoPathByFileId(telegramGroup.photo.big_file_id)
            : '';
        const group = GroupEntity.create({
            telegramId: telegramGroup.id,
            name: telegramGroup.title || 'Grupo sin nombre',
            description: telegramGroup.description || 'Grupo sin descripción',
            photoUrl: telegramGroupPhotoPath || '',
            members: groupDoc ? GroupMapper.fromDbToDomain(groupDoc).props.members : [],
        }, groupDoc ? UUID.from(groupDoc._id) : UUID.generate());
        return this.save(group);
    }
}