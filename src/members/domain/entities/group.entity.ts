import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserEntity } from "./user.entity";

export interface GroupEntityProps {
    telegramId: number;
    name: string;
    photoUrl: string;
    description: string;
    members: UserEntity[];
}

export class GroupEntity extends Entity<GroupEntityProps> {
    private constructor(props: GroupEntityProps, id?: UUID) {
        super(props, id);
    }

    static create(props: GroupEntityProps, id?: UUID): GroupEntity {
        return new GroupEntity(props, id);
    }

    get id(): UUID {
        return this._id;
    }

    addMember(user: UserEntity): void {
        if (!this.props.members.find(member => member.equals(user))) {
            this.props.members.push(user);
        }
    }

    hasMember(user: UserEntity): boolean {
        return this.props.members.some(member => member.equals(user));
    }
}