import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MembersModule } from 'src/members/members.module';
import { TmaAuthGuard } from './presentation/tma-auth.guard';

/**
 * Autenticación por `initData` de Telegram. Registra `TmaAuthGuard` como guard
 * global: toda ruta HTTP la exige salvo las marcadas con `@Public()`.
 */
@Module({
  imports: [MembersModule],
  providers: [{ provide: APP_GUARD, useClass: TmaAuthGuard }],
})
export class AuthModule {}
