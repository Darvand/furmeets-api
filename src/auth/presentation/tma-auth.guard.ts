import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import { UserService } from 'src/members/application/user.service';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import {
  InvalidInitDataError,
  InitDataUser,
  validateInitData,
} from '../domain/init-data.validator';
import { IS_PUBLIC_KEY } from './public.decorator';

const AUTH_SCHEME = 'tma';

/**
 * Guard global de HTTP (RNF-SEG-01, SEG-02). Lee `Authorization: tma <initDataRaw>`,
 * valida la firma y la vigencia, y crea o actualiza al usuario a partir de `initData`.
 * El usuario queda en `request.user`; nunca sale del body, de los params ni de otro header.
 *
 * Los rechazos se registran a nivel `warn` con el motivo, sin el `initData` (RNF-OBS-02).
 */
@Injectable()
export class TmaAuthGuard implements CanActivate {
  private readonly logger = new Logger(TmaAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly userService: UserService,
    @Inject(telegramBotConfig.KEY)
    private readonly config: ConfigType<typeof telegramBotConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      // El socket se autentica en su propio middleware (T04).
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

    let telegramUser: InitDataUser;
    try {
      telegramUser = validateInitData(initDataRaw, this.config.token).user;
    } catch (error) {
      if (error instanceof InvalidInitDataError) {
        return this.reject(request, error.reason);
      }
      throw error;
    }

    request.user = await this.userService.upsertFromTelegram({
      telegramId: telegramUser.id,
      name: [telegramUser.first_name, telegramUser.last_name]
        .filter(Boolean)
        .join(' '),
      username: telegramUser.username,
      avatarUrl: telegramUser.photo_url,
    });
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
