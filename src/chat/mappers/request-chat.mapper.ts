import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { RequestChat } from '../infraestructure/schemas/request-chat.schema';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  GetRequestChatDto,
  MemberRequestChatDto,
} from '../presentation/dtos/get-request-chat.dto';
import { UserMapper } from 'src/members/mappers/user.mapper';
import { RequestChatMessageMapper } from './request-chat-message.mapper';
import { ListRequestChatDto } from '../presentation/dtos/list-request-chat.dto';
import { RequestChatState } from '../domain/value-objects/request-chat-state.value-object';
import {
  type VoteThresholds,
  Votes,
  type VoteType,
} from 'src/review/domain/vote';
import { DateTime } from 'luxon';
import { User } from 'src/members/infraestructure/schemas/user.schema';
import { uuidRef } from 'src/shared/infraestructure/mongo-uuid';
import type { RequestChatPage } from '../domain/services/chat.repository';
import { RequestChatCursorCodec } from '../presentation/request-chat-cursor';
import { ApplicationFormMapper } from 'src/applications/mappers/application-form.mapper';
import type { RequestChatView, VoteResult } from '../application/chat.service';
import {
  RequestChatVotesEventDto,
  RequestChatVotingDto,
  VoteRequestChatDto,
  VoterDto,
} from '../presentation/dtos/vote-request-chat.dto';

export class RequestChatMapper {
  static toDb(requestChat: RequestChatEntity): RequestChat {
    return {
      _id: requestChat.id.value,
      requester: uuidRef<User>(requestChat.props.requester.id.value),
      votes: requestChat.votes.all().map((vote) => ({
        from: uuidRef<User>(vote.voter.id.value),
        type: vote.type,
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
        votes: Votes.of(
          dbRequestChat.votes.map((vote) => ({
            voter: UserMapper.fromDb(vote.from),
            type: vote.type as VoteType,
          })),
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

  /**
   * La solicitud para su solicitante, mientras no sea miembro: sin votos (RNF-PRI-03).
   * También es la base de lo que ven los miembros.
   */
  static toRequesterDto({
    requestChat,
    messages,
    hasOlder,
  }: RequestChatView): GetRequestChatDto {
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
      state: requestChat.state,
    };
  }

  /** La solicitud para un miembro: con la votación, nominal (RNF-PRI-01). */
  static toMemberDto(
    view: RequestChatView,
    /** Sin `viewer` (eventos que reciben todos) no se incluye `userVote`. */
    viewer?: UserEntity,
  ): MemberRequestChatDto {
    const { votes } = view.requestChat;
    return {
      ...RequestChatMapper.toRequesterDto(view),
      ...RequestChatMapper.toVotingDto(votes, view.thresholds),
      userVote: viewer && votes.typeOf(viewer.id),
    };
  }

  static toVoteDto(result: VoteResult): VoteRequestChatDto {
    return {
      ...RequestChatMapper.toVotesEvent(result),
      userVote: result.userVote,
    };
  }

  /** Evento `request-chat-votes`, para todos los miembros: sin `userVote`. */
  static toVotesEvent(result: VoteResult): RequestChatVotesEventDto {
    return {
      uuid: result.requestChatId.value,
      state: result.state,
      ...RequestChatMapper.toVotingDto(result.votes, result.thresholds),
    };
  }

  private static toVotingDto(
    votes: Votes,
    thresholds: VoteThresholds,
  ): RequestChatVotingDto {
    const voters = votes.voters();
    return {
      votes: votes.tally(),
      voters: {
        approve: voters.approve.map((voter) =>
          RequestChatMapper.toVoter(voter),
        ),
        reject: voters.reject.map((voter) => RequestChatMapper.toVoter(voter)),
      },
      thresholds: { ...thresholds },
    };
  }

  private static toVoter(voter: UserEntity): VoterDto {
    return {
      uuid: voter.id.value,
      name: voter.name,
      username: voter.username,
      avatarMediaId: voter.avatarMediaId,
    };
  }

  /**
   * Una página del listado. Fechas en ISO-8601 UTC; de los votos, solo conteos y el voto
   * propio: quién votó viene al abrir la solicitud.
   */
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
