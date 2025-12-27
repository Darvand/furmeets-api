import { GroupEntity } from "../entities/group.entity";

export interface GroupRepository {
        getGroup(): Promise<GroupEntity>;
        save(group: GroupEntity): Promise<GroupEntity>;
        sync(): Promise<GroupEntity>;
}