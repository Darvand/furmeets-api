import { ValueObject } from "src/shared/domain/value-objects/value-object";
import { ChatDate } from "../value-objects/chat-date.value-object";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { Entity } from "src/shared/domain/entities/entity";

interface ChatMessageViewedByProps {
    by: UserEntity;
    at: ChatDate;
}

export class ChatMessageViewedByEntity extends Entity<ChatMessageViewedByProps> {
    private constructor(props: ChatMessageViewedByProps) {
        super(props);
    }

    static create(props: ChatMessageViewedByProps): ChatMessageViewedByEntity {
        return new ChatMessageViewedByEntity(props);
    }

    get by(): UserEntity {
        return this.props.by;
    }

    get at(): ChatDate {
        return this.props.at;
    }
}

