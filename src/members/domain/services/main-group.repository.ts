import { GroupMember } from "../entities/group-member.entity";
import { MainGroupAggregate } from "../entities/main-group-aggregate.entity";

export interface MainGroupRepository {
    getGroup(): Promise<MainGroupAggregate | null>;
    syncMember(member: GroupMember): Promise<void>;
}