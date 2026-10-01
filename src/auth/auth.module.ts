import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ForbiddenLoggingFilter } from './presentation/forbidden-logging.filter';
import { MembersModule } from 'src/members/members.module';
import { InitDataAuthService } from './application/init-data-auth.service';
import { TmaAuthGuard } from './presentation/tma-auth.guard';

/**
 * Autenticación por `initData` de Telegram. Registra `TmaAuthGuard` como guard
 * global: toda ruta HTTP la exige salvo las marcadas con `@Public()`. Exporta
 * `InitDataAuthService` para autenticar el socket (`wsAuthMiddleware`). Los 403 se
 * registran en `warn` con `ForbiddenLoggingFilter`; la autorización por rol está en
 * `roles.guard.ts`.
 */
@Module({
  imports: [MembersModule],
  providers: [
    InitDataAuthService,
    { provide: APP_GUARD, useClass: TmaAuthGuard },
    { provide: APP_FILTER, useClass: ForbiddenLoggingFilter },
  ],
  exports: [InitDataAuthService],
})
export class AuthModule {}
