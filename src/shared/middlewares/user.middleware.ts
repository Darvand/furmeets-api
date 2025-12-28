import { Injectable, NestMiddleware, UnauthorizedException } from "@nestjs/common";
import { NextFunction, Response } from "express";
import { UserService } from "../../members/application/user.service";
import { CustomRequest } from "../types/custom-request.interface";

@Injectable()
export class UserMiddleware implements NestMiddleware {

    constructor(
        private readonly userService: UserService,
    ) { }

    async use(req: CustomRequest, res: Response, next: NextFunction) {
        const telegramIdHeader = req.headers['x-telegram-id'];
        if (telegramIdHeader) {
            const telegramId = Number(telegramIdHeader);
            const user = await this.userService.getUserByTelegramId(telegramId);
            if (user) {
                req.user = user;
                return next();
            }
        }
        throw new UnauthorizedException('User not authorized');
    }
}