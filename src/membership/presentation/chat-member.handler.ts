import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import {
  ChatMemberUpdate,
  TelegramBotService,
} from 'src/telegram-bot/telegram-bot.service';
import { MembershipService } from '../application/membership.service';

/**
 * Invalida el rol cacheado de un usuario cuando Telegram avisa que entró, salió, fue
 * expulsado o restringido en el grupo principal (RNF-SEG-10). Así la siguiente petición
 * refleja el rol nuevo sin esperar a que venza la caché.
 */
@Injectable()
export class ChatMemberHandler implements OnModuleInit {
  private readonly logger = new Logger(ChatMemberHandler.name);

  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly membershipService: MembershipService,
    @Inject(telegramBotConfig.KEY)
    private readonly config: ConfigType<typeof telegramBotConfig>,
  ) {}

  onModuleInit(): void {
    this.telegramBotService.onChatMember((update) => this.handle(update));
  }

  handle(update: ChatMemberUpdate): void {
    if (String(update.chatId) !== this.config.mainChatId) {
      return;
    }
    this.membershipService.invalidate(update.userId);
    this.logger.debug(`Rol invalidado por chat_member (${update.status})`);
  }
}
