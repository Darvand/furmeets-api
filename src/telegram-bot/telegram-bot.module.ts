import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';
import { TelegramBotMiddleware } from './telegram-bot.middleware';

@Module({
    imports: [],
    controllers: [TelegramBotController],
    providers: [TelegramBotService],
    exports: [TelegramBotService],
})
export class TelegramBotModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        // consumer.apply(TelegramBotMiddleware).forRoutes('*');
    }
}