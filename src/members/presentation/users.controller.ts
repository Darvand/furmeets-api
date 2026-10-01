import { Controller, ForbiddenException, Get, NotFoundException, Param, Req } from "@nestjs/common";
import { UserService } from "../application/user.service";
import { UserMapper } from "../mappers/user.mapper";
import type { CustomRequest } from "src/shared/types/custom-request.interface";
import { MembershipService } from "src/membership/application/membership.service";
import { Roles } from "src/membership/domain/role";

@Controller('users')
export class UsersController {
    constructor(
        private readonly userService: UserService,
        private readonly membershipService: MembershipService,
    ) { }

    @Get('/:telegramId')
    async getUserByTelegramId(@Param('telegramId') telegramId: number, @Req() req: CustomRequest) {
        // TmaAuthGuard ya cargó al usuario del request; si es el mismo, se evita una segunda consulta a `users`.
        if (req.user.telegramId === Number(telegramId)) {
            return UserMapper.toDto(req.user);
        }
        // Un solicitante solo puede verse a sí mismo.
        if ((await this.membershipService.resolveRole(req.user)) !== Roles.Member) {
            throw new ForbiddenException('Applicants can only read their own user');
        }
        const user = await this.userService.getUserByTelegramId(telegramId);
        if (!user) {
            throw new NotFoundException(`User with Telegram ID ${telegramId} not found`);
        }
        return UserMapper.toDto(user);
    }
}
