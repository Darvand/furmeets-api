import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Logger,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of, defer } from 'rxjs';
import request from 'supertest';
import type { Server } from 'http';
import { recordMongo } from '../timing/timing-context';
import { telegramTimingTransformer } from '../timing/telegram-timing';
import { httpTimingMiddleware, TimingInterceptor } from './timing.interceptor';

type TransformerArgs = Parameters<typeof telegramTimingTransformer>;

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

@Controller('things')
class ThingsController {
  @Get(':id')
  async get(@Param('id') id: string) {
    await tick();
    recordMongo(12);
    return { id };
  }

  @Get(':id/secret')
  secret() {
    throw new UnauthorizedException();
  }
}

describe('Timing', () => {
  let logSpy: jest.SpyInstance;
  const firstLine = (): string =>
    String((logSpy.mock.calls as unknown[][])[0]?.[0]);

  beforeEach(() => {
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('httpTimingMiddleware', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ThingsController],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      app.use(httpTimingMiddleware);
      await app.init();
    });

    afterAll(() => app.close());

    it('registra el patrón de ruta, el estado y el tiempo de Mongo, sin la URL real', async () => {
      await request(app.getHttpServer() as Server)
        .get('/things/123456789')
        .expect(200);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = firstLine();
      expect(line).toMatch(
        /^HTTP GET \/things\/:id 200 \d+ms \(mongo 12ms\/1 · telegram 0ms\/0\)$/,
      );
      expect(line).not.toContain('123456789');
    });

    it('también registra las peticiones que terminan en error', async () => {
      await request(app.getHttpServer() as Server)
        .get('/things/1/secret')
        .expect(401);

      expect(firstLine()).toMatch(/^HTTP GET \/things\/:id\/secret 401 /);
    });

    it('no registra la URL cuando ninguna ruta coincide', async () => {
      await request(app.getHttpServer() as Server)
        .get('/nope/987654321')
        .expect(404);

      const line = firstLine();
      expect(line).toMatch(/^HTTP GET \(sin ruta\) 404 /);
      expect(line).not.toContain('987654321');
    });
  });

  describe('TimingInterceptor', () => {
    const handler = () => undefined;
    Reflect.defineMetadata(MESSAGE_METADATA, 'request-chat', handler);
    const wsContext = {
      getType: () => 'ws',
      getHandler: () => handler,
    } as unknown as ExecutionContext;

    it('registra el evento con el tiempo de Mongo y Telegram del handler', async () => {
      const telegramCall = jest.fn(async () => {
        await tick();
        return { ok: true, result: true };
      });
      const next = {
        handle: () =>
          defer(async () => {
            await tick();
            recordMongo(7);
            await telegramTimingTransformer(
              telegramCall as unknown as TransformerArgs[0],
              'sendMessage',
              {} as TransformerArgs[2],
            );
          }),
      };

      await lastValueFrom(new TimingInterceptor().intercept(wsContext, next), {
        defaultValue: undefined,
      });

      expect(telegramCall).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(firstLine()).toMatch(
        /^WS request-chat ok \d+ms \(mongo 7ms\/1 · telegram \d+ms\/1\)$/,
      );
    });

    it('registra los eventos que fallan', async () => {
      const next = {
        handle: () => defer(() => Promise.reject(new Error('boom'))),
      };

      await expect(
        lastValueFrom(new TimingInterceptor().intercept(wsContext, next)),
      ).rejects.toThrow('boom');
      expect(firstLine()).toMatch(/^WS request-chat error /);
    });

    it('no hace nada fuera de los sockets', async () => {
      const httpContext = {
        getType: () => 'http',
      } as unknown as ExecutionContext;

      await lastValueFrom(
        new TimingInterceptor().intercept(httpContext, { handle: () => of(1) }),
      );
      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
