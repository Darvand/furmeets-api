import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { GroupRepository } from '../../domain/services/group.repository';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import type { ConfigType } from '@nestjs/config';
import { Group } from '../schemas/group.schema';
import { GroupEntity } from 'src/members/domain/entities/group.entity';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { GroupMapper } from 'src/members/mappers/group.mapper';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { MediaService } from 'src/media/application/media.service';
import { MediaKinds } from 'src/media/domain/media';

@Injectable()
export class GroupAdapterRepository implements GroupRepository {
  constructor(
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
    private readonly telegramBotService: TelegramBotService,
    private readonly mediaService: MediaService,
    @Inject(telegramBotConfig.KEY)
    private readonly config: ConfigType<typeof telegramBotConfig>,
  ) {}

  async getGroup(): Promise<GroupEntity> {
    const groupDoc = await this.groupModel
      .findOne({ telegramId: this.config.mainChatId })
      .populate('members')
      .lean<Group>()
      .exec();
    if (groupDoc) {
      return GroupMapper.fromDbToDomain(groupDoc);
    }
    throw new NotFoundException('Group not found in database');
  }

  async setMember(user: UserEntity, isMember: boolean): Promise<boolean> {
    const result = await this.groupModel.updateOne(
      { telegramId: this.config.mainChatId },
      isMember
        ? { $addToSet: { members: user.id.value } }
        : { $pull: { members: user.id.value } },
    );
    return result.matchedCount > 0;
  }

  async refreshFromTelegram(): Promise<void> {
    const telegramGroup = await this.telegramBotService.getGroup();
    // La foto pequeña (160 px) basta para el avatar del grupo.
    const photo = telegramGroup.photo;
    const photoMediaId = photo
      ? await this.mediaService.registerTelegramPhoto(MediaKinds.GroupPhoto, {
          file_id: photo.small_file_id,
          file_unique_id: photo.small_file_unique_id,
        })
      : undefined;
    await this.groupModel.updateOne(
      { telegramId: this.config.mainChatId },
      {
        $set: {
          name: telegramGroup.title || 'Grupo sin nombre',
          description: telegramGroup.description || 'Grupo sin descripción',
          ...(photoMediaId && { photoMediaId }),
        },
        ...(!photoMediaId && { $unset: { photoMediaId: '' } }),
        $setOnInsert: {
          _id: UUID.generate().value,
          members: [],
          createdAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: false },
    );
  }
}
