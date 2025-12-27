import { DateTime } from "luxon";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";

interface RequestChatVoteProps {
    user: UserEntity;
    type: 'approve' | 'reject';
    createdAt: DateTime;
}

export class RequestChatVoteEntity extends Entity<RequestChatVoteProps> {
    private constructor(props: RequestChatVoteProps, id?: UUID) {
        super(props, id);
    }

    static create(props: RequestChatVoteProps, id?: UUID): RequestChatVoteEntity {
        return new RequestChatVoteEntity(props, id);
    }

    static asApprove(user: UserEntity): RequestChatVoteEntity {
        return new RequestChatVoteEntity({
            user,
            type: 'approve',
            createdAt: DateTime.now(),
        });
    }

    static asReject(user: UserEntity): RequestChatVoteEntity {
        return new RequestChatVoteEntity({
            user,
            type: 'reject',
            createdAt: DateTime.now(),
        });
    }

    changeType(type: 'approve' | 'reject'): void {
        this.props.type = type;
    }

    equals(other: RequestChatVoteEntity): boolean {
        return this.props.user.id.value === other.props.user.id.value;
    }

    isApprove(): boolean {
        return this.props.type === 'approve';
    }

    isReject(): boolean {
        return this.props.type === 'reject';
    }
}