import { UserMapper } from "src/members/mappers/user.mapper";
import { RequestChatMessageEntity } from "../domain/entities/request-chat-message.entity";
import { CreateRequestChatMessageDto } from "../presentation/dtos/create-request-chat-message.dto";
import { GetRequestChatMessageDto } from "../presentation/dtos/get-request-chat-message.dto";
import { RequestChatMessage } from "../infraestructure/schemas/request-chat-message.schema";
import { UserEntity } from "src/members/domain/entities/user.entity";

export class RequestChatMessageMapper {
    // static toDomain(dto: RequestChatMessageDto): RequestChatMessage {
    //     return RequestChatMessage.create({
    //         content: dto.content,
    //         userId: dto.userId,
    //     });
    // }

    static toDto(message: RequestChatMessageEntity, viewer: UserEntity): GetRequestChatMessageDto {
        return {
            uuid: message.id.value,
            content: message.props.content,
            user: UserMapper.toDto(message.props.user),
            sentAt: message.at,
            viewedByRequester: message.viewedByUser(viewer),
        }
    }

    static toDb(message: RequestChatMessageEntity): RequestChatMessage {
        return {
            _id: message.id.value,
            content: message.props.content,
            user: message.props.user.id.value as any,
            viewedBy: message.props.viewedBy.map(viewedBy => ({
                by: viewedBy.by.id.value as any,
                viewedAt: viewedBy.at.toJSDate(),
            })),
        }
    }
}