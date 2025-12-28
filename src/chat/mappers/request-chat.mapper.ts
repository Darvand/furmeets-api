import { UserEntity } from "src/members/domain/entities/user.entity";
import { RequestChatEntity } from "../domain/entities/request-chat.entity";
import { RequestChat } from "../infraestructure/schemas/request-chat.schema";
import { RequestChatMessageEntity } from "../domain/entities/request-chat-message.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GetRequestChatDto } from "../presentation/dtos/get-request-chat.dto";
import { UserMapper } from "src/members/mappers/user.mapper";
import { RequestChatMessageMapper } from "./request-chat-message.mapper";
import { ListRequestChatDto } from "../presentation/dtos/list-request-chat.dto";
import { RequestChatState } from "../domain/value-objects/request-chat-state.value-object";
import { RequestChatVoteEntity } from "../domain/entities/request-chat-vote.entity";
import { DateTime } from "luxon";
import { ChatDate } from "../domain/value-objects/chat-date.value-object";
import { ChatMessageViewedByEntity } from "../domain/entities/chat-message-viewed-by.entity";

export class RequestChatMapper {
    static toDb(requestChat: RequestChatEntity): RequestChat {
        return {
            _id: requestChat.id.value,
            requester: requestChat.props.requester.id.value as any,
            votes: requestChat.props.votes.map(vote => ({
                from: vote.props.user.id.value as any,
                type: vote.props.type,
            })),
            state: requestChat.state,
            messages: requestChat.props.messages.map(message => RequestChatMessageMapper.toDb(message)),
            interests: requestChat.props.interests,
            whereYouFoundUs: requestChat.props.whereYouFoundUs,
        }
    }

    static fromDb(dbRequestChat: RequestChat): RequestChatEntity {
        const requestChat = RequestChatEntity.create({
            requester: UserMapper.fromDb(dbRequestChat.requester),
            createdAt: DateTime.fromJSDate(dbRequestChat.createdAt!),
            state: RequestChatState.create(dbRequestChat.state),
            votes: dbRequestChat.votes.map(vote => RequestChatVoteEntity.create({
                user: UserMapper.fromDb(vote.from),
                type: vote.type as any,
                createdAt: DateTime.fromJSDate(vote.createdAt!),
            })),
            messages: dbRequestChat.messages.map(msg => {
                return RequestChatMessageEntity.create({
                    content: msg.content,
                    user: UserMapper.fromDb(msg.user),
                    createdAt: ChatDate.fromJSDate(msg.createdAt!),
                    viewedBy: msg.viewedBy.map(viewed => ChatMessageViewedByEntity.create({
                        by: UserMapper.fromDb(viewed.by),
                        at: ChatDate.fromJSDate(viewed.createdAt!),
                    })),
                }, UUID.from(msg._id));
            }),
            interests: dbRequestChat.interests,
            whereYouFoundUs: dbRequestChat.whereYouFoundUs,
        }, UUID.from(dbRequestChat._id));
        return requestChat;
    }

    static toDto(requestChat: RequestChatEntity, viewer: UserEntity): GetRequestChatDto {
        return {
            uuid: requestChat.id.value,
            requester: UserMapper.toDto(requestChat.props.requester),
            messages: requestChat.props.messages.map(message => RequestChatMessageMapper.toDto(message, viewer)),
            interests: requestChat.props.interests,
            whereYouFoundUs: requestChat.props.whereYouFoundUs,
            votes: {
                approved: requestChat.countApproves(),
                rejected: requestChat.countRejects(),
            },
            state: requestChat.state,
            userVote: requestChat.getUserVoteType(viewer),
        }
    }

    static toDtoList(requestChats: RequestChatEntity[], viewer: UserEntity): ListRequestChatDto {
        return {
            items: requestChats
                .sort((a, b) => b.props.createdAt.toMillis() - a.props.createdAt.toMillis())
                .map(chat => {
                    const lastMessage = chat.lastMessage();
                    return {
                        uuid: chat.id.value,
                        requester: UserMapper.toDto(chat.props.requester),
                        lastMessage: {
                            at: lastMessage.props.createdAt.at,
                            content: lastMessage.props.content,
                            from: UserMapper.toDto(lastMessage.props.user),
                        },
                        state: chat.state,
                        unreadMessagesCount: chat.unreadMessagesCount(viewer),
                    }
                }),
        }
    }
}