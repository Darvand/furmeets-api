import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestChatMessageEntity } from 'src/chat/domain/entities/request-chat-message.entity';
import { RequestChatMessageRepository } from 'src/chat/domain/services/request-chat-message.repository';
import {
  RequestChatMessageMapper,
  type RequestChatMessageDoc,
} from 'src/chat/mappers/request-chat-message.mapper';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessage } from '../schemas/request-chat-message.schema';

/** Del más antiguo al más reciente (`createdAt` es único por el reloj monótono). */
const CHRONOLOGICAL = { createdAt: 1 } as const;

@Injectable()
export class RequestChatMessageMongoRepository
  implements RequestChatMessageRepository
{
  constructor(
    @InjectModel(RequestChatMessage.name)
    private readonly messageModel: Model<RequestChatMessage>,
  ) {}

  async insert(message: RequestChatMessageEntity): Promise<void> {
    await this.messageModel.insertOne(RequestChatMessageMapper.toDb(message));
  }

  async findByRequestChat(
    requestChatId: UUID,
  ): Promise<RequestChatMessageEntity[]> {
    const docs = await this.messageModel
      .find({ requestChatId: requestChatId.value })
      .sort(CHRONOLOGICAL)
      .populate('authorId')
      .lean<RequestChatMessageDoc[]>()
      .exec();
    return docs.map((doc) => RequestChatMessageMapper.fromDb(doc));
  }

  async findByRequestChats(
    requestChatIds: UUID[],
  ): Promise<Map<string, RequestChatMessageEntity[]>> {
    const byRequestChat = new Map<string, RequestChatMessageEntity[]>(
      requestChatIds.map((id) => [id.value, []]),
    );
    if (requestChatIds.length === 0) {
      return byRequestChat;
    }
    const docs = await this.messageModel
      .find({ requestChatId: { $in: requestChatIds.map((id) => id.value) } })
      .sort(CHRONOLOGICAL)
      .populate('authorId')
      .lean<RequestChatMessageDoc[]>()
      .exec();
    for (const doc of docs) {
      const message = RequestChatMessageMapper.fromDb(doc);
      byRequestChat.get(message.requestChatId.value)?.push(message);
    }
    return byRequestChat;
  }

  async markAllReadBy(
    requestChatId: UUID,
    user: UserEntity,
    at: Date,
  ): Promise<void> {
    await this.messageModel.updateMany(
      {
        requestChatId: requestChatId.value,
        'readBy.userId': { $ne: user.id.value },
      },
      { $push: { readBy: { userId: user.id.value, at } } },
    );
  }
}
