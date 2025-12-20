import { UserEntity } from "src/members/domain/entities/user.entity";
import { RequestChatEntity } from "../domain/entities/request-chat.entity";
import { RequestChat } from "../infraestructure/schemas/request-chat.schema";
import { RequestChatMessageEntity } from "../domain/entities/request-chat-message.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GetRequestChatDto } from "../presentation/dtos/get-request-chat.dto";
import { UserMapper } from "src/members/mappers/user.mapper";
import { RequestChatMessageMapper } from "./request-chat-message.mapper";
import { ListRequestChatDto } from "../presentation/dtos/list-request-chat.dto";

export class RequestChatMapper {
    static toDb(requestChat: RequestChatEntity): RequestChat {
        return {
            _id: requestChat.id.value,
            requester: requestChat.requesterId as any,
            messages: requestChat.messages.map(message => ({
                _id: message.id.value,
                user: message.userId.value,
                content: message.content,
                createdAt: message.props.createdAt,
            })) as any
        }
    }

    static fromDb(dbRequestChat: RequestChat): RequestChatEntity {
        const requestChat = RequestChatEntity.create({
            requester: UserEntity.create({
                avatarUrl: dbRequestChat.requester.avatarUrl,
                name: dbRequestChat.requester.name,
                username: dbRequestChat.requester.username,
                telegramId: dbRequestChat.requester.telegramId,
            }, UUID.from(dbRequestChat.requester._id)),
            createdAt: dbRequestChat.createdAt!,
            messages: dbRequestChat.messages.map(msg => {
                return RequestChatMessageEntity.create({
                    content: msg.content,
                    user: UserEntity.create({
                        avatarUrl: msg.user.avatarUrl,
                        name: msg.user.name,
                        username: msg.user.username,
                        telegramId: msg.user.telegramId,
                    }, UUID.from(msg.user._id)),
                    createdAt: msg.createdAt,
                }, UUID.from(msg._id));
            })
        }, UUID.from(dbRequestChat._id));
        return requestChat;
    }

    static toDto(requestChat: RequestChatEntity): GetRequestChatDto {
        return {
            uuid: requestChat.id.value,
            requester: UserMapper.toDto(requestChat.props.requester),
            createdAt: requestChat.props.createdAt,
            messages: requestChat.props.messages.map(message => RequestChatMessageMapper.toDto(message)),
        }
    }

    static toDtoList(requestChats: RequestChatEntity[]): ListRequestChatDto {
        return {
            items: requestChats.map(this.toDto),
        }
    }
}