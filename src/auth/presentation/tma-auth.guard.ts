import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { InitDataAuthService } from '../application/init-data-auth.service';
import { InvalidInitDataError } from '../domain/init-data.validator';
import { IS_PUBLIC_KEY } from './public.decorator';

const AUTH_SCHEME = 'tma';

/**
 * Guard global de HTTP (RNF-SEG-01, SEG-02). Lee `Authorization: tma <initDataRaw>`
 * y autentica al usuario con `InitDataAuthService` (firma, vigencia y registro).
 * El usuario queda en `request.user`; nunca sale del body, de los params ni de otro header.
 *
 * Los rechazos se registran a nivel `warn` con el motivo, sin el `initData` (RNF-OBS-02).
 */
@Injectable()
export class TmaAuthGuard implements CanActivate {
  private readonly logger = new Logger(TmaAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly initDataAuth: InitDataAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      // El socket se autentica al conectar, en `wsAuthMiddleware`.
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<CustomRequest>();
    const initDataRaw = this.extractInitData(request.headers.authorization);
    if (!initDataRaw) {
      return this.reject(request, 'missing-authorization');
    }

    try {
      request.user = await this.initDataAuth.authenticate(initDataRaw);
    } catch (error) {
      if (error instanceof InvalidInitDataError) {
        return this.reject(request, error.reason);
      }
      throw error;
    }
    return true;
  }

  private extractInitData(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const [scheme, ...rest] = header.trim().split(' ');
    if (scheme.toLowerCase() !== AUTH_SCHEME) return undefined;
    const value = rest.join(' ').trim();
    return value || undefined;
  }

  private reject(request: CustomRequest, reason: string): never {
    const route =
      (request.route as { path?: string } | undefined)?.path ?? '(sin ruta)';
    this.logger.warn(
      `Autenticación rechazada: ${reason} · ${request.method} ${route}`,
    );
    throw new UnauthorizedException('Invalid or missing Telegram initData');
  }
}
