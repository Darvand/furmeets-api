import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { MESSAGE_METADATA } from '@nestjs/websockets/constants';
import type { NextFunction, Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import {
  createTimingStore,
  elapsedMs,
  formatTiming,
  runWithTiming,
} from '../timing/timing-context';

const logger = new Logger('Timing');

/**
 * Registra la duración de cada petición HTTP (RNF-OBS-03): método, patrón de ruta,
 * estado y ms totales, con el tiempo de Mongo y de Telegram por separado.
 *
 * Es un middleware global (`app.use`) y no un interceptor porque los interceptores de
 * Nest corren después de los middlewares: no medirían la búsqueda del usuario de
 * `UserMiddleware` ni verían los 401 que lanza.
 *
 * Solo se registra el patrón (`/request-chats/:id`), nunca la URL, el body ni los
 * headers, para no dejar datos personales en los logs.
 */
export function httpTimingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();
  const store = createTimingStore();
  let logged = false;
  const log = () => {
    if (logged) return;
    logged = true;
    const route =
      (req.route as { path?: string } | undefined)?.path ?? '(sin ruta)';
    const status = res.writableFinished ? String(res.statusCode) : 'abortada';
    logger.log(
      formatTiming(
        `HTTP ${req.method} ${route} ${status}`,
        elapsedMs(startedAt),
        store,
      ),
    );
  };
  res.once('finish', log);
  res.once('close', log);
  runWithTiming(store, () => next());
}

/**
 * Registra la duración de cada evento de socket: nombre del evento, resultado y ms
 * totales, con el tiempo de Mongo y de Telegram por separado. Nunca registra el payload.
 * Se aplica al gateway con `@UseInterceptors(TimingInterceptor)`.
 */
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'ws') {
      return next.handle();
    }
    const event =
      (Reflect.getMetadata(MESSAGE_METADATA, context.getHandler()) as
        | string
        | undefined) ?? '(desconocido)';
    const startedAt = process.hrtime.bigint();
    const store = createTimingStore();
    const log = (result: string) =>
      logger.log(
        formatTiming(`WS ${event} ${result}`, elapsedMs(startedAt), store),
      );

    // La suscripción (que ejecuta el handler) ocurre dentro del contexto, para que las
    // llamadas a Mongo y Telegram del handler sumen su tiempo aquí.
    return new Observable((subscriber) =>
      runWithTiming(store, () =>
        next
          .handle()
          .pipe(tap({ complete: () => log('ok'), error: () => log('error') }))
          .subscribe(subscriber),
      ),
    );
  }
}
