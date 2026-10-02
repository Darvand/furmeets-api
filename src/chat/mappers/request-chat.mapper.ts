import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { RequestChat } from '../infraestructure/schemas/request-chat.schema';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { GetRequestChatDto } from '../presentation/dtos/get-request-chat.dto';
import { UserMapper } from 'src/members/mappers/user.mapper';
import { RequestChatMessageMapper } from './request-chat-message.mapper';
import { ListRequestChatDto } from '../presentation/dtos/list-request-chat.dto';
import { RequestChatState } from '../domain/value-objects/request-chat-state.value-object';
import { RequestChatVoteEntity } from '../domain/entities/request-chat-vote.entity';
import { DateTime } from 'luxon';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import { uuidRef } from 'src/shared/infraestructure/mongo-uuid';

export class RequestChatMapper {
  static toDb(requestChat: RequestChatEntity): RequestChat {
    return {
      _id: requestChat.id.value,
      requester: uuidRef<User>(requestChat.props.requester.id.value),
      votes: requestChat.props.votes.map((vote) => ({
        from: uuidRef<User>(vote.props.user.id.value),
        type: vote.props.type,
      })),
      state: requestChat.state,
      interests: requestChat.props.interests,
      whereYouFoundUs: requestChat.props.whereYouFoundUs,
    };
  }

  static fromDb(dbRequestChat: RequestChat): RequestChatEntity {
    const requestChat = RequestChatEntity.create(
      {
        requester: UserMapper.fromDb(dbRequestChat.requester),
        createdAt: DateTime.fromJSDate(dbRequestChat.createdAt!),
        state: RequestChatState.create(dbRequestChat.state),
        votes: dbRequestChat.votes.map((vote) =>
          RequestChatVoteEntity.create({
            user: UserMapper.fromDb(vote.from),
            type: vote.type as 'approve' | 'reject',
            createdAt: DateTime.fromJSDate(vote.createdAt!),
          }),
        ),
        interests: dbRequestChat.interests,
        whereYouFoundUs: dbRequestChat.whereYouFoundUs,
      },
      UUID.from(dbRequestChat._id),
    );
    return requestChat;
  }

  static toDto(
    requestChat: RequestChatEntity,
    messages: RequestChatMessageEntity[],
    viewer: UserEntity,
  ): GetRequestChatDto {
    return {
      uuid: requestChat.id.value,
      requester: UserMapper.toDto(requestChat.props.requester),
      messages: messages.map((message) =>
        RequestChatMessageMapper.toDto(message, viewer),
      ),
      interests: requestChat.props.interests,
      whereYouFoundUs: requestChat.props.whereYouFoundUs,
      votes: {
        approved: requestChat.countApproves(),
        rejected: requestChat.countRejects(),
      },
      state: requestChat.state,
      userVote: requestChat.getUserVoteType(viewer),
    };
  }

  /**
   * Listado de solicitudes con su último mensaje y los no leídos de `viewer`.
   * `messagesByChat` trae los mensajes de cada solicitud en orden cronológico (T40 lo
   * cambia por una agregación que no los carga).
   */
  static toDtoList(
    requestChats: RequestChatEntity[],
    messagesByChat: Map<string, RequestChatMessageEntity[]>,
    viewer: UserEntity,
  ): ListRequestChatDto {
    return {
      items: requestChats
        .sort(
          (a, b) => b.props.createdAt.toMillis() - a.props.createdAt.toMillis(),
        )
        .map((chat) => {
          const messages = messagesByChat.get(chat.id.value) ?? [];
          const lastMessage = messages.at(-1);
          return {
            uuid: chat.id.value,
            requester: UserMapper.toDto(chat.props.requester),
            // Una solicitud sin mensajes (antes de migrarla, T12) no tiene último mensaje.
            lastMessage: lastMessage && {
              at: lastMessage.createdAt.toISOString(),
              content: lastMessage.content,
              from: UserMapper.toDto(lastMessage.author),
            },
            state: chat.state,
            unreadMessagesCount: messages.filter((m) => !m.isReadBy(viewer))
              .length,
          };
        }),
    };
  }
}
