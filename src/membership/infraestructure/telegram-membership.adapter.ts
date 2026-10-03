import { Injectable } from '@nestjs/common';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { ChatMemberStatus } from '../domain/role';
import { TelegramMembershipPort } from '../domain/telegram-membership.port';

@Injectable()
export class TelegramMembershipAdapter implements TelegramMembershipPort {
  constructor(private readonly telegramBotService: TelegramBotService) {}

  getChatMember(telegramId: number): Promise<ChatMemberStatus> {
    return this.telegramBotService.getMemberFromGroup(telegramId);
  }
}
