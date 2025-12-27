import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { MainGroupAggregate } from "../domain/entities/main-group-aggregate.entity";
import { MemberMapper } from "./member.mapper";
import { GroupDto } from "../presentation/dtos/group.dto";
import { GroupEntity } from "../domain/entities/group.entity";
import { GetGroupDto } from "../presentation/dtos/get-group.dto";
import { UserMapper } from "./user.mapper";
import { Group } from "../infraestructure/schemas/group.schema";

export class GroupMapper {
    static fromDbToDomain(groupDb: Group): GroupEntity {
        const groupEntity = GroupEntity.create({
            telegramId: groupDb.telegramId,
            name: groupDb.name,
            photoUrl: groupDb.photoUrl,
            description: groupDb.description,
            members: groupDb.members.map(memberDb => UserMapper.fromDb(memberDb)),
        }, UUID.from(groupDb._id));
        return groupEntity;
    }

    static toPersistence(group: GroupEntity): Group {
        return {
            _id: group.id.value,
            telegramId: group.props.telegramId,
            name: group.props.name,
            photoUrl: group.props.photoUrl,
            description: group.props.description,
            members: group.props.members.map(member => member.id.value) as any[],
        };
    }

    static toDto(group: GroupEntity): GetGroupDto {
        return {
            uuid: group.id.value,
            telegramId: group.props.telegramId,
            name: group.props.name,
            photoUrl: group.props.photoUrl,
            description: group.props.description,
            members: group.props.members.map(member => UserMapper.toDto(member)),
        };
    }
}