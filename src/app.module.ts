import { Module } from '@nestjs/common';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { ConfigModule } from '@nestjs/config';
import telegramBotConfig from './telegram-bot/telegram-bot.config';

@Module({
  imports: [
    TelegramBotModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [telegramBotConfig]
    })
  ]
})
export class AppModule { }
