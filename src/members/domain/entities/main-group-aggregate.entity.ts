import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GroupMember } from "./group-member.entity";

export interface MainGroupAggregateProps {
    telegramId: number;
    name: string;
    members: GroupMember[];
    createdAt: Date;
}

export class MainGroupAggregate extends Entity<MainGroupAggregateProps> {
    private constructor(props: MainGroupAggregateProps, id?: UUID) {
        super(props, id);
    }

    static create(props: MainGroupAggregateProps, id?: UUID): MainGroupAggregate {
        return new MainGroupAggregate(props, id);
    }

    hasMember(member: GroupMember): boolean {
        return this.props.members.some(m => m.equals(member));
    }

    getMember(telegramId: number): GroupMember | undefined {
        return this.props.members.find(m => m.props.telegramId === telegramId);
    }

    addMember(member: GroupMember): void {
        if (this.hasMember(member)) {
            throw new Error('Member already exists in the group');
        }
        this.props.members.push(member);
    }

    get id(): UUID {
        return this._id;
    }

    get telegramId(): number {
        return this.props.telegramId;
    }

    get name(): string {
        return this.props.name;
    }

    get members(): GroupMember[] {
        return this.props.members;
    }

    get createdAt(): Date {
        return this.props.createdAt;
    }
}