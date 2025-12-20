import { Module } from "@nestjs/common";
import { MEMBERS_PROVIDERS } from "./members.providers";
import { UserMongoRepository } from "./infraestructure/repositories/user-mongo.repository";
import { UserService } from "./application/user.service";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "./infraestructure/schemas/user.schema";
import { DatabaseModule } from "src/database/database.module";
import { UsersController } from "./presentation/users.controller";

@Module({
    providers: [
        UserService,
        {
            provide: MEMBERS_PROVIDERS.UserRepository,
            useClass: UserMongoRepository
        }
    ],
    exports: [
        UserService,
        MongooseModule,
    ],
    controllers: [
        UsersController,
    ],
    imports: [
        DatabaseModule,
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
        ])
    ]
})
export class MembersModule { }