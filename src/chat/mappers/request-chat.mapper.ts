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
import type { RequestChatPage } from '../domain/services/chat.repository';
import { RequestChatCursorCodec } from '../presentation/request-chat-cursor';
import type { VoteResult } from '../application/chat.service';
import { VoteRequestChatDto } from '../presentation/dtos/vote-request-chat.dto';

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
        RequestChatMessageMapper.toDto(message),
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

  static toVoteDto(result: VoteResult): VoteRequestChatDto {
    return {
      uuid: result.requestChatId.value,
      state: result.state,
      votes: { ...result.votes },
      userVote: result.userVote,
    };
  }

  /** Una página del listado. Fechas en ISO-8601 UTC; de los votos, solo conteos. */
  static toDtoList(page: RequestChatPage): ListRequestChatDto {
    return {
      items: page.items.map((item) => ({
        uuid: item.id.value,
        requester: UserMapper.toDto(item.requester),
        // Una solicitud sin mensajes (antes de migrarla, T12) no tiene último mensaje.
        lastMessage: item.lastMessage && {
          at: item.lastMessage.at.toISOString(),
          content: item.lastMessage.content,
          from: UserMapper.toDto(item.lastMessage.author),
        },
        state: item.state,
        votes: { ...item.votes },
        userVote: item.viewerVote,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: page.next && RequestChatCursorCodec.encode(page.next),
    };
  }
}
