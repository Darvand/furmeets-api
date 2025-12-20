import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";

export interface UserProps {
    username: string;
    avatarUrl: string;
    name: string;
    createdAt?: Date;
}

export class UserEntity extends Entity<UserProps> {
    private constructor(props: UserProps, id?: UUID) {
        super(props, id);
    }
    static create(props: UserProps, id?: UUID): UserEntity {
        return new UserEntity(props, id);
    }

    get id(): UUID {
        return this._id;
    }

    get username(): string {
        return this.props.username;
    }

    get avatarUrl(): string {
        return this.props.avatarUrl;
    }

    get name(): string {
        return this.props.name;
    }
}