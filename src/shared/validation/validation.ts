import { Provider, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

/**
 * Única configuración del ValidationPipe global (RNF-SEG-05).
 * - whitelist: descarta propiedades sin decoradores de class-validator.
 * - forbidNonWhitelisted: en lugar de descartarlas, responde 400.
 * - transform: convierte el payload a la clase del DTO (y los params a su tipo).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}

/**
 * Se registra como APP_PIPE en AppModule, así la app (main.ts) y las pruebas
 * e2e (que importan AppModule) usan exactamente la misma validación.
 */
export const VALIDATION_PIPE_PROVIDER: Provider = {
  provide: APP_PIPE,
  useFactory: createValidationPipe,
};
