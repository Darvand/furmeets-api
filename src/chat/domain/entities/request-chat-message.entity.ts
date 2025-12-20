import { UserEntity } from "src/members/domain/entities/user.entity";
import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { TelegramUser } from "src/telegram-bot/domain/entities/telegram-user.entity";

export interface RequestChatMessageProps {
    user: UserEntity;
    content: string;
    createdAt?: Date;
}

export class RequestChatMessageEntity extends Entity<RequestChatMessageProps> {
    private constructor(props: RequestChatMessageProps, id?: UUID) {
        super(props, id);
    }

    static create(props: RequestChatMessageProps, id?: UUID): RequestChatMessageEntity {
        return new RequestChatMessageEntity(props, id);
    }

    get id(): UUID {
        return this._id;
    }

    get userId(): UUID {
        return this.props.user.id;
    }

    get content(): string {
        return this.props.content;
    }
}