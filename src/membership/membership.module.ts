import { Module } from '@nestjs/common';
import { TelegramBotModule } from 'src/telegram-bot/telegram-bot.module';
import { MembershipService } from './application/membership.service';
import { TELEGRAM_MEMBERSHIP_PORT } from './domain/telegram-membership.port';
import { TelegramMembershipAdapter } from './infraestructure/telegram-membership.adapter';
import { ChatMemberHandler } from './presentation/chat-member.handler';

/**
 * Rol en vivo contra Telegram con caché invalidada por eventos. Solo depende del bot,
 * así cualquier módulo puede importarlo sin ciclos. `GET /me` vive en `MeModule`.
 */
@Module({
  imports: [TelegramBotModule],
  providers: [
    MembershipService,
    ChatMemberHandler,
    { provide: TELEGRAM_MEMBERSHIP_PORT, useClass: TelegramMembershipAdapter },
  ],
  exports: [MembershipService],
})
export class MembershipModule {}
