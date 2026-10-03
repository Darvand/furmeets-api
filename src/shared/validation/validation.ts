import { Provider, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { WsException } from '@nestjs/websockets';

const OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
} as const;

/**
 * Única configuración del ValidationPipe global (RNF-SEG-05).
 * - whitelist: descarta propiedades sin decoradores de class-validator.
 * - forbidNonWhitelisted: en lugar de descartarlas, responde 400.
 * - transform: convierte el payload a la clase del DTO (y los params a su tipo).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe(OPTIONS);
}

/**
 * La misma validación para los eventos de socket, que el APP_PIPE no cubre: se aplica
 * con `@UsePipes` en cada handler. Rechaza con `WsException('invalid-payload')`, que
 * llega al cliente como evento `exception` con el payload en `cause.data`.
 */
export function createWsValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    ...OPTIONS,
    exceptionFactory: () => new WsException('invalid-payload'),
  });
}

/**
 * Se registra como APP_PIPE en AppModule, así la app (main.ts) y las pruebas
 * e2e (que importan AppModule) usan exactamente la misma validación. Solo cubre HTTP:
 * los gateways usan `createWsValidationPipe`.
 */
export const VALIDATION_PIPE_PROVIDER: Provider = {
  provide: APP_PIPE,
  useFactory: createValidationPipe,
};
