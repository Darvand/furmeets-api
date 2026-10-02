import { UserMapper } from 'src/members/mappers/user.mapper';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { GetRequestChatMessageDto } from '../presentation/dtos/get-request-chat-message.dto';
import { RequestChatMessage } from '../infraestructure/schemas/request-chat-message.schema';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import { uuidRef } from 'src/shared/infraestructure/mongo-uuid';

export class RequestChatMessageMapper {
  static toDto(
    message: RequestChatMessageEntity,
    viewer: UserEntity,
  ): GetRequestChatMessageDto {
    return {
      uuid: message.id.value,
      content: message.props.content,
      user: UserMapper.toDto(message.props.user),
      sentAt: message.at,
      viewedByRequester: message.viewedByUser(viewer),
    };
  }

  static toDb(message: RequestChatMessageEntity): RequestChatMessage {
    return {
      _id: message.id.value,
      content: message.props.content,
      user: uuidRef<User>(message.props.user.id.value),
      viewedBy: message.props.viewedBy.map((viewedBy) => ({
        by: uuidRef<User>(viewedBy.by.id.value),
        viewedAt: viewedBy.at.toJSDate(),
      })),
    };
  }
}
