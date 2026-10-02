import { Module, NestModule } from '@nestjs/common';
import { TelegramBotController } from './telegram-bot.controller';
import { TelegramBotService } from './telegram-bot.service';

@Module({
  imports: [],
  controllers: [TelegramBotController],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule implements NestModule {
  configure() {
    // consumer.apply(TelegramBotMiddleware).forRoutes('*');
  }
}
