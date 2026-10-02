import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { GroupEntity } from '../domain/entities/group.entity';
import { GetGroupDto } from '../presentation/dtos/get-group.dto';
import { UserMapper } from './user.mapper';
import { Group } from '../infraestructure/schemas/group.schema';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';

export class GroupMapper {
  static fromDbToDomain(groupDb: Group): GroupEntity {
    const groupEntity = GroupEntity.create(
      {
        telegramId: groupDb.telegramId,
        name: groupDb.name,
        photoMediaId: groupDb.photoMediaId
          ? toUUIDString(groupDb.photoMediaId)
          : undefined,
        description: groupDb.description,
        members: groupDb.members.map((memberDb) => UserMapper.fromDb(memberDb)),
      },
      UUID.from(toUUIDString(groupDb._id)),
    );
    return groupEntity;
  }

  static toDto(group: GroupEntity): GetGroupDto {
    return {
      uuid: group.id.value,
      telegramId: group.props.telegramId,
      name: group.props.name,
      photoMediaId: group.props.photoMediaId,
      description: group.props.description,
      members: group.props.members.map((member) => UserMapper.toDto(member)),
    };
  }
}
