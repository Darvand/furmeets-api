import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { UserRepository } from "src/members/domain/services/user.repository";
import { User } from "../schemas/user.schema";
import { Model } from "mongoose";
import { UserEntity } from "src/members/domain/entities/user.entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserMapper } from "src/members/mappers/user.mapper";

@Injectable()
export class UserMongoRepository implements UserRepository {

    private readonly logger = new Logger(UserMongoRepository.name);
    constructor(
        @InjectModel(User.name) private readonly userModel: Model<User>,
    ) { }

    async getByUUID(uuid: UUID): Promise<UserEntity | null> {
        Logger.debug(`Fetching user with ID: ${uuid.value}`);
        const userDoc = await this.userModel.findOne({ _id: uuid.value }).exec();
        if (!userDoc) {
            return null;
        }
        return UserMapper.fromDb(userDoc);
    }
}