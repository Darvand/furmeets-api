import { UserEntity } from "src/members/domain/entities/user.entity";
import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { ChatDate } from "../value-objects/chat-date.value-object";
import { ChatMessageViewedByEntity } from "./chat-message-viewed-by.entity";

export interface RequestChatMessageProps {
    user: UserEntity;
    content: string;
    viewedBy: ChatMessageViewedByEntity[];
    createdAt: ChatDate;
}

export class RequestChatMessageEntity extends Entity<RequestChatMessageProps> {
    private constructor(props: RequestChatMessageProps, id?: UUID) {
        super(props, id);
    }

    static create(props: RequestChatMessageProps, id?: UUID): RequestChatMessageEntity {
        return new RequestChatMessageEntity(props, id);
    }

    markAsViewedBy(user: UserEntity): void {
        if (!this.props.viewedBy.find(u => u.by.equals(user))) {
            this.props.viewedBy.push(ChatMessageViewedByEntity.create({ by: user, at: ChatDate.now() }));
        }
    }

    viewedByUser(user: UserEntity): boolean {
        return this.props.viewedBy.some(u => u.by.equals(user));
    }

    get id(): UUID {
        return this._id;
    }

    get at(): string {
        return this.props.createdAt.at;
    }
}