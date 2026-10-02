import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TelegramBotService } from './telegram-bot/telegram-bot.service';
import telegramBotConfig from './telegram-bot/telegram-bot.config';
import { TelegramBotServer } from './telegram-bot/telegram-bot.server';
import { Logger, LogLevel } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { httpTimingMiddleware } from './shared/interceptors/timing.interceptor';

async function bootstrap() {
  const logLevels = process.env.LOGGER_OPTIONS?.split(',') as
    | LogLevel[]
    | undefined;
  const app = await NestFactory.create(AppModule, {
    logger: logLevels || ['error', 'warn', 'log'],
  });
  app.use(httpTimingMiddleware);
  app.enableCors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  });
  const bot = app.get(TelegramBotService);
  const config = app.get<ConfigType<typeof telegramBotConfig>>(
    telegramBotConfig.KEY,
  );
  app.connectMicroservice(
    { strategy: new TelegramBotServer(bot, config) },
    { inheritAppConfig: true },
  );
  await app.listen(process.env.PORT ?? 3000);
  await app.startAllMicroservices();
  Logger.log(`Application is running on: ${await app.getUrl()}`);
}
void bootstrap();
