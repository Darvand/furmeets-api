import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestChatMessageEntity } from 'src/chat/domain/entities/request-chat-message.entity';
import type {
  InsertedMessage,
  MessagesPage,
  RequestChatMessageRepository,
} from 'src/chat/domain/services/request-chat-message.repository';
import {
  RequestChatMessageMapper,
  type RequestChatMessageDoc,
} from 'src/chat/mappers/request-chat-message.mapper';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessage } from '../schemas/request-chat-message.schema';

/**
 * Del más antiguo al más reciente. `createdAt` es único entre los mensajes nuevos (reloj
 * monótono), pero los migrados sin fecha propia (T12) comparten la de su solicitud: `_id`
 * desempata. Los dos órdenes usan el índice `requestChatId + createdAt + _id`.
 */
const CHRONOLOGICAL = { createdAt: 1, _id: 1 } as const;
const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

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

  findLatest(requestChatId: UUID, limit: number): Promise<MessagesPage> {
    return this.page(requestChatId, 'older', limit);
  }

  async findBefore(
    requestChatId: UUID,
    beforeId: UUID,
    limit: number,
  ): Promise<MessagesPage | null> {
    const at = await this.sentAt(requestChatId, beforeId);
    return at && this.page(requestChatId, 'older', limit, { id: beforeId, at });
  }

  async findAfter(
    requestChatId: UUID,
    afterId: UUID,
    limit: number,
  ): Promise<MessagesPage | null> {
    const at = await this.sentAt(requestChatId, afterId);
    return at && this.page(requestChatId, 'newer', limit, { id: afterId, at });
  }

  /** `createdAt` de un mensaje; `null` si no es de esa solicitud. */
  private async sentAt(
    requestChatId: UUID,
    messageId: UUID,
  ): Promise<Date | null> {
    const message = await this.messageModel
      .findOne(
        { _id: messageId.value, requestChatId: requestChatId.value },
        { createdAt: 1 },
      )
      .lean<{ createdAt: Date }>()
      .exec();
    return message?.createdAt ?? null;
  }

  /**
   * Hasta `limit` mensajes desde el más cercano a `anchor` (excluido) hacia los
   * anteriores o los posteriores, devueltos en orden. Sin `anchor`, desde el final.
   */
  private async page(
    requestChatId: UUID,
    direction: 'older' | 'newer',
    limit: number,
    anchor?: { id: UUID; at: Date },
  ): Promise<MessagesPage> {
    const op = direction === 'older' ? '$lt' : '$gt';
    const beyondAnchor = anchor && {
      $or: [
        { createdAt: { [op]: anchor.at } },
        { createdAt: anchor.at, _id: { [op]: anchor.id.value } },
      ],
    };
    // Uno de más para saber si quedan.
    const docs = await this.messageModel
      .find({ requestChatId: requestChatId.value, ...beyondAnchor })
      .sort(direction === 'older' ? NEWEST_FIRST : CHRONOLOGICAL)
      .limit(limit + 1)
      .populate('authorId')
      .lean<RequestChatMessageDoc[]>()
      .exec();
    const items = docs
      .slice(0, limit)
      .map((doc) => RequestChatMessageMapper.fromDb(doc));
    return {
      items: direction === 'older' ? items.reverse() : items,
      hasMore: docs.length > limit,
    };
  }
}
