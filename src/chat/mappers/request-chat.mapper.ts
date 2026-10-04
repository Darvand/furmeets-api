import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { RequestChat } from '../infraestructure/schemas/request-chat.schema';
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
import { ApplicationFormMapper } from 'src/applications/mappers/application-form.mapper';
import type { RequestChatView, VoteResult } from '../application/chat.service';
import {
  RequestChatVotesEventDto,
  VoteRequestChatDto,
} from '../presentation/dtos/vote-request-chat.dto';

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
      form:
        requestChat.props.form &&
        ApplicationFormMapper.toDb(requestChat.props.form),
      legacy: requestChat.props.legacy && { ...requestChat.props.legacy },
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
        form:
          dbRequestChat.form &&
          ApplicationFormMapper.fromDb(dbRequestChat.form),
        legacy: dbRequestChat.legacy && {
          howDidYouFindUs: dbRequestChat.legacy.howDidYouFindUs,
          interests: dbRequestChat.legacy.interests,
        },
      },
      UUID.from(dbRequestChat._id),
    );
    return requestChat;
  }

  static toDto(
    { requestChat, messages, hasOlder }: RequestChatView,
    /** Sin `viewer` (eventos que reciben todos) no se incluye `userVote`. */
    viewer?: UserEntity,
  ): GetRequestChatDto {
    return {
      uuid: requestChat.id.value,
      requester: UserMapper.toDto(requestChat.props.requester),
      messages: messages.map((message) =>
        RequestChatMessageMapper.toDto(message),
      ),
      hasOlderMessages: hasOlder,
      form:
        requestChat.props.form &&
        ApplicationFormMapper.toDto(requestChat.props.form),
      legacy: requestChat.props.legacy && { ...requestChat.props.legacy },
      votes: {
        approved: requestChat.countApproves(),
        rejected: requestChat.countRejects(),
      },
      state: requestChat.state,
      userVote: viewer && requestChat.getUserVoteType(viewer),
    };
  }

  static toVoteDto(result: VoteResult): VoteRequestChatDto {
    return {
      ...RequestChatMapper.toVotesEvent(result),
      userVote: result.userVote,
    };
  }

  /** Evento `request-chat-votes`: estado y conteos, sin el voto de nadie (RNF-PRI-01). */
  static toVotesEvent(result: VoteResult): RequestChatVotesEventDto {
    return {
      uuid: result.requestChatId.value,
      state: result.state,
      votes: { ...result.votes },
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
