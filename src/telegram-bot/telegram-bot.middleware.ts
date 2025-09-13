import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';

@Injectable()
export class TelegramBotMiddleware implements NestMiddleware {
    private readonly logger = new Logger(TelegramBotMiddleware.name);
    constructor(private readonly bot: TelegramBotService) { }

    use(req: any, res: any, next: (error?: any) => void) {
        this.logger.debug('Middleware called', req.body);
        // return this.bot.middleware()(req, res);
    }
}