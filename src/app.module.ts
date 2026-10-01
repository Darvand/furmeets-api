import { Module } from '@nestjs/common';
import { TelegramBotModule } from './telegram-bot/telegram-bot.module';
import { ConfigModule } from '@nestjs/config';
import telegramBotConfig from './telegram-bot/telegram-bot.config';
import { ChatModule } from './chat/chat.module';
import databaseConfig from './database/database.config';
import { DatabaseModule } from './database/database.module';
import { AppController } from './app.controller';
import { VALIDATION_PIPE_PROVIDER } from './shared/validation/validation';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    TelegramBotModule,
    ChatModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [telegramBotConfig, databaseConfig]
    })
  ],
  controllers: [AppController],
  providers: [VALIDATION_PIPE_PROVIDER],
})
export class AppModule { }
