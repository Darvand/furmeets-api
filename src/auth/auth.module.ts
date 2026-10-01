import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MembersModule } from 'src/members/members.module';
import { InitDataAuthService } from './application/init-data-auth.service';
import { TmaAuthGuard } from './presentation/tma-auth.guard';

/**
 * Autenticación por `initData` de Telegram. Registra `TmaAuthGuard` como guard
 * global: toda ruta HTTP la exige salvo las marcadas con `@Public()`. Exporta
 * `InitDataAuthService` para autenticar el socket (`wsAuthMiddleware`).
 */
@Module({
  imports: [MembersModule],
  providers: [
    InitDataAuthService,
    { provide: APP_GUARD, useClass: TmaAuthGuard },
  ],
  exports: [InitDataAuthService],
})
export class AuthModule {}
