import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TelegramBotService } from './telegram-bot/telegram-bot.service';
import telegramBotConfig from './telegram-bot/telegram-bot.config';
import { TelegramBotServer } from './telegram-bot/telegram-bot.server';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const bot = app.get(TelegramBotService);
  const config = app.get(telegramBotConfig.KEY);
  app.connectMicroservice(
    { strategy: new TelegramBotServer(bot, config) },
    { inheritAppConfig: true },
  )
  await app.listen(process.env.PORT ?? 3000);
  await app.startAllMicroservices();
  Logger.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap();
