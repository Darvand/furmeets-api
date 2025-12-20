import { Module } from '@nestjs/common';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { ConfigModule } from '@nestjs/config';
import telegramBotConfig from './telegram-bot/telegram-bot.config';
import { ChatModule } from './chat/chat.module';
import databaseConfig from './database/database.config';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    DatabaseModule,
    TelegramBotModule,
    ChatModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [telegramBotConfig, databaseConfig]
    })
  ]
})
export class AppModule { }
