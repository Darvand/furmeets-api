import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import { UserService } from "../application/user.service";
import { UserMapper } from "../mappers/user.mapper";
import { CreateUserDto } from "./dtos/create-user.dto";
import { GetUserDto } from "./dtos/get-user.dto";
import type { CustomRequest } from "src/shared/types/custom-request.interface";

@Controller('users')
export class UsersController {
    constructor(
        private readonly userService: UserService,
    ) { }

    @Get('/:telegramId')
    async getUserByTelegramId(@Param('telegramId') telegramId: number, @Req() req: CustomRequest) {
        // UserMiddleware ya cargó al usuario del request; si es el mismo, se evita una segunda consulta a `users`.
        if (req.user && req.user.telegramId === Number(telegramId)) {
            return UserMapper.toDto(req.user);
        }
        const user = await this.userService.getUserByTelegramId(telegramId);
        if (!user) {
            throw new NotFoundException(`User with Telegram ID ${telegramId} not found`);
        }
        return UserMapper.toDto(user);
    }

    @Post()
    async createUser(@Body() createUserDto: CreateUserDto): Promise<GetUserDto> {
        const user = await this.userService.createUser(createUserDto);
        return UserMapper.toDto(user);
    }
}
