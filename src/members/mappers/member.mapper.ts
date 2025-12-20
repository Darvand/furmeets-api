import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GroupMember } from "../domain/entities/group-member.entity";

export class MemberMapper {
    static toDomain(raw: any): GroupMember {
        return GroupMember.create({
            username: raw.username,
            telegramId: raw.telegramId,
        }, UUID.from(raw.id));
    }
}