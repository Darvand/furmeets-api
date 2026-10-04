import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestChatMessageEntity } from 'src/chat/domain/entities/request-chat-message.entity';
import type {
  InsertedMessage,
  MessagesAfter,
  RequestChatMessageRepository,
} from 'src/chat/domain/services/request-chat-message.repository';
import {
  MESSAGE_AUTHORS,
  RequestChatMessageMapper,
  type RequestChatMessageDoc,
} from 'src/chat/mappers/request-chat-message.mapper';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessage } from '../schemas/request-chat-message.schema';

/** Del más antiguo al más reciente (`createdAt` es único por el reloj monótono). */
const CHRONOLOGICAL = { createdAt: 1 } as const;

const isDuplicateKey = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === 11000;

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

  async insertOnce(
    message: RequestChatMessageEntity,
  ): Promise<InsertedMessage> {
    try {
      await this.insert(message);
      return { message, created: true };
    } catch (error) {
      // El índice único resuelve los reenvíos, también los simultáneos: el primero
      // inserta y los demás leen el suyo.
      if (!message.clientMessageId || !isDuplicateKey(error)) {
        throw error;
      }
    }
    const existing = await this.messageModel
      .findOne({
        requestChatId: message.requestChatId.value,
        authorId: message.author.id.value,
        clientMessageId: message.clientMessageId,
      })
      .populate('replyTo.authorId')
      .lean<Omit<RequestChatMessageDoc, 'authorId'>>()
      .orFail()
      .exec();
    return {
      message: RequestChatMessageMapper.fromDbWithAuthor(
        existing,
        message.author,
      ),
      created: false,
    };
  }

  async findAfter(
    requestChatId: UUID,
    afterId: UUID,
    limit: number,
  ): Promise<MessagesAfter | null> {
    const anchor = await this.messageModel
      .findOne(
        { _id: afterId.value, requestChatId: requestChatId.value },
        { createdAt: 1 },
      )
      .lean<{ createdAt: Date }>()
      .exec();
    if (!anchor) {
      return null;
    }
    // Uno de más para saber si quedan; usa el índice `requestChatId + createdAt`.
    const docs = await this.messageModel
      .find({
        requestChatId: requestChatId.value,
        createdAt: { $gt: anchor.createdAt },
      })
      .sort(CHRONOLOGICAL)
      .limit(limit + 1)
      .populate(MESSAGE_AUTHORS)
      .lean<RequestChatMessageDoc[]>()
      .exec();
    return {
      items: docs
        .slice(0, limit)
        .map((doc) => RequestChatMessageMapper.fromDb(doc)),
      hasMore: docs.length > limit,
    };
  }

  async findInRequestChat(
    requestChatId: UUID,
    messageId: UUID,
  ): Promise<RequestChatMessageEntity | null> {
    const doc = await this.messageModel
      .findOne({ _id: messageId.value, requestChatId: requestChatId.value })
      .populate(MESSAGE_AUTHORS)
      .lean<RequestChatMessageDoc>()
      .exec();
    return doc ? RequestChatMessageMapper.fromDb(doc) : null;
  }

  async findByRequestChat(
    requestChatId: UUID,
  ): Promise<RequestChatMessageEntity[]> {
    const docs = await this.messageModel
      .find({ requestChatId: requestChatId.value })
      .sort(CHRONOLOGICAL)
      .populate(MESSAGE_AUTHORS)
      .lean<RequestChatMessageDoc[]>()
      .exec();
    return docs.map((doc) => RequestChatMessageMapper.fromDb(doc));
  }
}
