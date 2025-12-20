import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";

export interface GroupMemberProps {
    username: string;
    telegramId: number;
}

export class GroupMember extends Entity<GroupMemberProps> {
    private constructor(props: GroupMemberProps, id?: UUID) {
        super(props, id);
    }

    static create(props: GroupMemberProps, id?: UUID): GroupMember {
        return new GroupMember(props, id);
    }

    equals(other: GroupMember): boolean {
        return this.props.telegramId === other.props.telegramId;
    }

    get id(): UUID {
        return this._id;
    }

    get username(): string {
        return this.props.username;
    }

    get telegramId(): number {
        return this.props.telegramId;
    }
}