import { UserMapper } from 'src/members/mappers/user.mapper';
import type { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { GetRequestChatMessageDto } from '../presentation/dtos/get-request-chat-message.dto';
import { RequestChatMessage } from '../infraestructure/schemas/request-chat-message.schema';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';

type UUIDValue = Parameters<typeof toUUIDString>[0];

/** Un mensaje leído con `lean()` y su autor poblado (`populate('authorId')`). */
export interface RequestChatMessageDoc {
  _id: UUIDValue;
  requestChatId: UUIDValue;
  authorId: User;
  content: string;
  createdAt: Date;
  clientMessageId?: string;
}

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

  /** Sin poblar `authorId`, cuando el autor ya se conoce (p. ej. en un reenvío). */
  static fromDbWithAuthor(
    doc: Omit<RequestChatMessageDoc, 'authorId'>,
    author: UserEntity,
  ): RequestChatMessageEntity {
    return RequestChatMessageEntity.create(
      {
        requestChatId: UUID.from(toUUIDString(doc.requestChatId)),
        author,
        content: doc.content,
        createdAt: doc.createdAt,
        clientMessageId: doc.clientMessageId,
      },
      UUID.from(toUUIDString(doc._id)),
    );
  }
}
