import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserEntity } from "../domain/entities/user.entity";
import { User } from "../infraestructure/schemas/user.schema";
import { GetUserDto } from "../presentation/dtos/get-user.dto";
import { CreateUserDto } from "../presentation/dtos/create-user.dto";

export class UserMapper {
    static fromDb(user: User): UserEntity {
        return UserEntity.create({
            username: user.username,
            avatarUrl: user.avatarUrl,
            createdAt: user.createdAt,
            name: user.name,
            telegramId: user.telegramId,
        }, UUID.from(user._id));
    }

    static toDto(user: UserEntity): GetUserDto {
        return {
            uuid: user.id.value,
            name: user.name,
            username: user.username,
            avatarUrl: user.avatarUrl,
            telegramId: user.telegramId,
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
        }
    }

    static fromDtoToDomain(createUserDto: CreateUserDto): UserEntity {
        return UserEntity.create({
            username: createUserDto.username,
            name: createUserDto.name,
            avatarUrl: createUserDto.avatarUrl,
            telegramId: createUserDto.telegramId,
        });
    }
}