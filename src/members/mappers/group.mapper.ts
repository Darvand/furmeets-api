import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { MainGroupAggregate } from "../domain/entities/main-group-aggregate.entity";
import { MemberMapper } from "./member.mapper";
import { GroupDto } from "../presentation/dtos/group.dto";

export class GroupMapper {
    static toDomain(raw: any): MainGroupAggregate {
        const members = raw.members.map((member: any) => MemberMapper.toDomain(member));
        return MainGroupAggregate.create({
            telegramId: raw.telegramId,
            name: raw.name,
            createdAt: raw.createdAt,
            members,
        }, UUID.from(raw.id));
    }

    static toDto(group: MainGroupAggregate): GroupDto {
        return {
            id: group.id.value,
            telegramId: group.telegramId,
            name: group.name,
            createdAt: group.createdAt,
            members: group.members.map(member => ({
                id: member.id?.value,
                username: member.props.username,
                telegramId: member.props.telegramId,
            })),
        };
    }
}