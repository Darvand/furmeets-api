import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { Species, UserEntity } from '../domain/entities/user.entity';
import { User } from '../infraestructure/schemas/user.schema';
import { GetUserDto } from '../presentation/dtos/get-user.dto';
import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';

export class UserMapper {
  static fromDb(user: User): UserEntity {
    const userEntity = UserEntity.create(
      {
        username: user.username,
        avatarMediaId: user.avatarMediaId
          ? toUUIDString(user.avatarMediaId)
          : undefined,
        createdAt: user.createdAt,
        name: user.name,
        telegramId: user.telegramId,
        isMember: user.isMember,
        birthdate: user.birthdate,
      },
      UUID.from(toUUIDString(user._id)),
    );
    userEntity.species = user.species;
    return userEntity;
  }

  static toDto(user: UserEntity): GetUserDto {
    return {
      uuid: user.id.value,
      name: user.name,
      username: user.username,
      avatarMediaId: user.avatarMediaId,
      telegramId: user.telegramId,
      species: user.species,
      birthdate: user.birthdate,
    };
  }

  static toDb(user: UserEntity): User {
    return {
      _id: user.id.value,
      username: user.username,
      avatarMediaId: user.avatarMediaId,
      name: user.name,
      telegramId: user.telegramId,
      createdAt: user.createdAt,
      isMember: user.isMember,
      birthdate: user.birthdate,
      species: user.species,
    };
  }
}
