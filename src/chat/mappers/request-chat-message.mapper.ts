import { UserMapper } from 'src/members/mappers/user.mapper';
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
}

export class RequestChatMessageMapper {
  /** Fechas en ISO-8601 UTC: el formato y la zona horaria los decide el cliente. */
  static toDto(message: RequestChatMessageEntity): GetRequestChatMessageDto {
    return {
      uuid: message.id.value,
      content: message.content,
      user: UserMapper.toDto(message.author),
      sentAt: message.createdAt.toISOString(),
    };
  }

  static toDb(message: RequestChatMessageEntity): RequestChatMessage {
    return {
      _id: message.id.value,
      requestChatId: message.requestChatId.value,
      authorId: message.author.id.value,
      content: message.content,
      createdAt: message.createdAt,
    };
  }

  static fromDb(doc: RequestChatMessageDoc): RequestChatMessageEntity {
    return RequestChatMessageEntity.create(
      {
        requestChatId: UUID.from(toUUIDString(doc.requestChatId)),
        author: UserMapper.fromDb(doc.authorId),
        content: doc.content,
        createdAt: doc.createdAt,
      },
      UUID.from(toUUIDString(doc._id)),
    );
  }
}
