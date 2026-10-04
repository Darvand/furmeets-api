import { UserMapper } from 'src/members/mappers/user.mapper';
import type { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  type MessageReply,
  RequestChatMessageEntity,
} from '../domain/entities/request-chat-message.entity';
import { GetRequestChatMessageDto } from '../presentation/dtos/get-request-chat-message.dto';
import { RequestChatMessage } from '../infraestructure/schemas/request-chat-message.schema';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';

type UUIDValue = Parameters<typeof toUUIDString>[0];

/**
 * Un mensaje leído con `lean()`, con su autor y el de la cita poblados
 * (`MESSAGE_AUTHORS`).
 */
export interface RequestChatMessageDoc {
  _id: UUIDValue;
  requestChatId: UUIDValue;
  authorId: User;
  /** Puede faltar en documentos viejos: se lee como vacío. */
  content?: string;
  imageIds?: UUIDValue[];
  replyTo?: {
    messageId: UUIDValue;
    authorId: User;
    excerpt?: string;
    hasImages?: boolean;
  };
  createdAt: Date;
  clientMessageId?: string;
}

/** Lo que hay que poblar al leer un mensaje: su autor y el del mensaje citado. */
export const MESSAGE_AUTHORS = ['authorId', 'replyTo.authorId'];

export class RequestChatMessageMapper {
  /** Fechas en ISO-8601 UTC: el formato y la zona horaria los decide el cliente. */
  static toDto(message: RequestChatMessageEntity): GetRequestChatMessageDto {
    const dto: GetRequestChatMessageDto = {
      uuid: message.id.value,
      requestChatUUID: message.requestChatId.value,
      content: message.content,
      user: UserMapper.toDto(message.author),
      sentAt: message.createdAt.toISOString(),
    };
    if (message.imageIds.length) {
      dto.imageIds = [...message.imageIds];
    }
    if (message.replyTo) {
      dto.replyTo = {
        uuid: message.replyTo.messageId.value,
        user: UserMapper.toDto(message.replyTo.author),
        excerpt: message.replyTo.excerpt,
        hasImages: message.replyTo.hasImages,
      };
    }
    if (message.clientMessageId) {
      dto.clientMessageId = message.clientMessageId;
    }
    return dto;
  }

  static toDb(message: RequestChatMessageEntity): RequestChatMessage {
    const doc: RequestChatMessage = {
      _id: message.id.value,
      requestChatId: message.requestChatId.value,
      authorId: message.author.id.value,
      content: message.content,
      createdAt: message.createdAt,
    };
    if (message.imageIds.length) {
      doc.imageIds = [...message.imageIds];
    }
    if (message.replyTo) {
      doc.replyTo = {
        messageId: message.replyTo.messageId.value,
        authorId: message.replyTo.author.id.value,
        excerpt: message.replyTo.excerpt,
        hasImages: message.replyTo.hasImages,
      };
    }
    if (message.clientMessageId) {
      doc.clientMessageId = message.clientMessageId;
    }
    return doc;
  }

  static fromDb(doc: RequestChatMessageDoc): RequestChatMessageEntity {
    return RequestChatMessageMapper.fromDbWithAuthor(
      doc,
      UserMapper.fromDb(doc.authorId),
    );
  }

  /**
   * Sin poblar `authorId`, cuando el autor ya se conoce (p. ej. en un reenvío). La cita
   * sí debe venir poblada.
   */
  static fromDbWithAuthor(
    doc: Omit<RequestChatMessageDoc, 'authorId'>,
    author: UserEntity,
  ): RequestChatMessageEntity {
    return RequestChatMessageEntity.create(
      {
        requestChatId: UUID.from(toUUIDString(doc.requestChatId)),
        author,
        content: doc.content ?? '',
        imageIds: doc.imageIds?.length
          ? doc.imageIds.map(toUUIDString)
          : undefined,
        replyTo: doc.replyTo ? replyFromDb(doc.replyTo) : undefined,
        createdAt: doc.createdAt,
        clientMessageId: doc.clientMessageId,
      },
      UUID.from(toUUIDString(doc._id)),
    );
  }
}

function replyFromDb(
  reply: NonNullable<RequestChatMessageDoc['replyTo']>,
): MessageReply {
  return {
    messageId: UUID.from(toUUIDString(reply.messageId)),
    author: UserMapper.fromDb(reply.authorId),
    excerpt: reply.excerpt ?? '',
    hasImages: reply.hasImages ?? false,
  };
}
