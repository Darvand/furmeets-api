import { Controller, Get, Param } from "@nestjs/common";
import { UserService } from "../application/user.service";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { UserMapper } from "../mappers/user.mapper";

@Controller('users')
export class UsersController {
    constructor(
        private readonly userService: UserService,
    ) { }

    @Get('/:userId')
    async getUser(@Param('userId') userId: string) {
        const user = await this.userService.getUserByUUID(UUID.from(userId));
        return UserMapper.toDto(user);
    }
}