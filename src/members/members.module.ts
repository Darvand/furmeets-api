import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { MEMBERS_PROVIDERS } from "./members.providers";
import { UserMongoRepository } from "./infraestructure/repositories/user-mongo.repository";
import { UserService } from "./application/user.service";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "./infraestructure/schemas/user.schema";
import { DatabaseModule } from "src/database/database.module";
import { UsersController } from "./presentation/users.controller";
import { TelegramBotModule } from "src/telegram-bot/telegram-bot.module";
import { GroupsController } from "./presentation/groups.controller";
import { GroupsService } from "./application/groups.service";
import { GroupAdapterRepository } from "./infraestructure/repositories/group-adapter.repository";
import { Group, GroupSchema } from "./infraestructure/schemas/group.schema";
import { UserMiddleware } from "../shared/middlewares/user.middleware";

@Module({
    providers: [
        UserService,
        GroupsService,
        {
            provide: MEMBERS_PROVIDERS.UserRepository,
            useClass: UserMongoRepository
        },
        {
            provide: MEMBERS_PROVIDERS.GroupRepository,
            useClass: GroupAdapterRepository,
        }
    ],
    exports: [
        UserService,
        MongooseModule,
    ],
    controllers: [
        UsersController,
        GroupsController,
    ],
    imports: [
        DatabaseModule,
        TelegramBotModule,
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
            { name: Group.name, schema: GroupSchema }
        ])
    ]
})
export class MembersModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(UserMiddleware)
            .exclude('groups/sync')
            .forRoutes(GroupsController, UsersController)
    }
}