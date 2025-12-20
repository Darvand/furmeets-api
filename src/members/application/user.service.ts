import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { MEMBERS_PROVIDERS } from "../members.providers";
import { UserEntity } from "../domain/entities/user.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import type { UserRepository } from "../domain/services/user.repository";

@Injectable()
export class UserService {
    constructor(
        @Inject(MEMBERS_PROVIDERS.UserRepository) private readonly userRepository: UserRepository,
    ) { }

    async getUserByUUID(uuid: UUID): Promise<UserEntity> {
        const user = await this.userRepository.getByUUID(uuid);
        if (!user) {
            throw new NotFoundException(`User with UUID ${uuid.value} not found`);
        }
        return user;
    }
}