import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { UserService } from "../application/user.service";
import { UserMapper } from "../mappers/user.mapper";
import { CreateUserDto } from "./dtos/create-user.dto";
import { GetUserDto } from "./dtos/get-user.dto";

@Controller('users')
export class UsersController {
    constructor(
        private readonly userService: UserService,
    ) { }

    @Get('/:telegramId')
    async getUserByTelegramId(@Param('telegramId') telegramId: number) {
        const user = await this.userService.getUserByTelegramId(telegramId);
        return UserMapper.toDto(user);
    }

    @Post()
    async createUser(@Body() createUserDto: CreateUserDto): Promise<GetUserDto> {
        const user = await this.userService.createUser(createUserDto);
        return UserMapper.toDto(user);
    }
}