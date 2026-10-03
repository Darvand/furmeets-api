import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';

/**
 * Registra a nivel `warn` toda autorización rechazada en HTTP (RNF-OBS-02): método,
 * patrón de ruta y motivo, sin ids de la URL ni datos del usuario. Responde el 403
 * igual que Nest por defecto.
 */
@Catch(ForbiddenException)
export class ForbiddenLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger('Authorization');

  catch(exception: ForbiddenException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<CustomRequest>();
    const route =
      (request.route as { path?: string } | undefined)?.path ?? '(sin ruta)';
    this.logger.warn(
      `Autorización rechazada: ${exception.message} · ${request.method} ${route}`,
    );
    http
      .getResponse<Response>()
      .status(exception.getStatus())
      .json(exception.getResponse());
  }
}
