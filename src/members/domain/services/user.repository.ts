import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserEntity } from "../entities/user.entity";

export interface UserRepository {
    getByUUID(uuid: UUID): Promise<UserEntity | null>;
}