import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { Species, UserEntity } from "../domain/entities/user.entity";
import { User } from "../infraestructure/schemas/user.schema";
import { GetUserDto } from "../presentation/dtos/get-user.dto";
import { CreateUserDto } from "../presentation/dtos/create-user.dto";

export class UserMapper {
    static fromDb(user: User): UserEntity {
        const userEntity = UserEntity.create({
            username: user.username,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt,
            name: user.name,
            telegramId: user.telegramId,
            isMember: user.isMember,
            birthdate: user.birthdate,
        }, UUID.from(user._id));
        userEntity.species = user.species;
        return userEntity;
    }

    static toDto(user: UserEntity): GetUserDto {
        return {
            uuid: user.id.value,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            telegramId: user.telegramId,
            species: user.species,
            birthdate: user.birthdate,
        }
    }

    static toDb(user: UserEntity): User {
        return {
            _id: user.id.value,
            username: user.username,
            avatarUrl: user.avatarUrl,
            name: user.name,
            telegramId: user.telegramId,
            createdAt: user.createdAt,
            isMember: user.isMember,
            birthdate: user.birthdate,
            species: user.species,
        }
    }

    static fromDtoToDomain(createUserDto: CreateUserDto): UserEntity {
        const userEntity = UserEntity.create({
            username: createUserDto.username,
            name: createUserDto.name,
            avatarUrl: createUserDto.avatarUrl,
            telegramId: createUserDto.telegramId,
            birthdate: createUserDto.birthdate,
            isMember: false,
        });
        userEntity.species = createUserDto.species;
        return userEntity;
    }
}