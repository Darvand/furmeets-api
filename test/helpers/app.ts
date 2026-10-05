import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AppModule } from '../../src/app.module';
import { TelegramBotService } from '../../src/telegram-bot/telegram-bot.service';
import {
  signInitData,
  SignInitDataOptions,
  TelegramInitDataUser,
} from './init-data';

/** Token falso con el que se firman los `initData` de prueba (ver `signInitData`). */
export const TEST_BOT_TOKEN = '123456:TEST-BOT-TOKEN';
export const TEST_GROUP_ID = '-1001234567890';

/** Valor del header `Authorization` con un `initData` firmado con `TEST_BOT_TOKEN`. */
export function tmaAuth(
  user: TelegramInitDataUser,
  options?: SignInitDataOptions,
): string {
  return `tma ${signInitData(user, TEST_BOT_TOKEN, options)}`;
}

type TelegramBotStub = { [K in keyof TelegramBotService]: jest.Mock };

/**
 * Doble de `TelegramBotService`: ningún método llama a Telegram. Cada método es
 * un `jest.fn()` que resuelve `undefined`; las pruebas pueden reemplazar su
 * implementación (`telegramBot.isMember.mockResolvedValue(true)`).
 */
export function createTelegramBotStub(): TelegramBotStub {
  const methods = Object.getOwnPropertyNames(
    TelegramBotService.prototype,
  ).filter((name) => name !== 'constructor') as (keyof TelegramBotService)[];
  return Object.fromEntries(
    methods.map((name) => [name, jest.fn().mockResolvedValue(undefined)]),
  ) as TelegramBotStub;
}

export interface TestApp {
  app: INestApplication;
  mongo: MongoMemoryServer;
  telegramBot: TelegramBotStub;
  close: () => Promise<void>;
}

export interface CreateTestAppOptions {
  /** Permite sobreescribir más providers antes de compilar el módulo. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/**
 * Levanta la app Nest completa (AppModule, con su ValidationPipe global) contra
 * un MongoDB en memoria, aislado de la BD de desarrollo.
 *
 * El bot de Telegram no arranca: el servidor del bot solo se conecta en
 * `main.ts` (`connectMicroservice`), que las pruebas no ejecutan, y
 * `TelegramBotService` se reemplaza por un doble sin red.
 */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<TestApp> {
  const mongo = await MongoMemoryServer.create();
  // Las variables del proceso tienen prioridad sobre `.env`, así nunca se usa
  // la BD ni el token reales aunque exista un `.env` local.
  process.env.DB_URI = mongo.getUri('furmeets-test');
  process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN;
  process.env.TELEGRAM_GROUP_ID = TEST_GROUP_ID;
  // Los de SPEC §3.3, aunque el `.env` local tenga otros.
  process.env.APPROVE_THRESHOLD = '5';
  process.env.REJECT_THRESHOLD = '5';

  const telegramBot = createTelegramBotStub();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TelegramBotService)
    .useValue(telegramBot);
  if (options.configure) {
    builder = options.configure(builder);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  await app.init();

  return {
    app,
    mongo,
    telegramBot,
    close: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}
