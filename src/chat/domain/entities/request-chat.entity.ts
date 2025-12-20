import { Entity } from "src/shared/domain/entities/entity";
import { TelegramUser } from "src/telegram-bot/domain/entities/telegram-user.entity";
import { RequestChatMessageEntity } from "./request-chat-message.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserEntity } from "src/members/domain/entities/user.entity";

export interface RequestChatProps {
    requester: UserEntity;
    messages: RequestChatMessageEntity[];
    createdAt: Date;
}

export class RequestChatEntity extends Entity<RequestChatProps> {
    private constructor(props: RequestChatProps, id?: UUID) {
        super(props, id);
    }
    static create(props: RequestChatProps, id?: UUID): RequestChatEntity {
        return new RequestChatEntity(props, id);
    }

    addMessage(message: RequestChatMessageEntity): void {
        this.props.messages.push(message);
    }

    get requesterId(): string {
        return this.props.requester.id.value;
    }

    get messages(): RequestChatMessageEntity[] {
        return this.props.messages;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }

    get id(): UUID {
        return this._id;
    }
}