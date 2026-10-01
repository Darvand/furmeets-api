import { Inject, Injectable } from '@nestjs/common';
import { TtlCache } from 'src/shared/cache/ttl-cache';
import { Role, roleFromChatMember } from '../domain/role';
import {
  TELEGRAM_MEMBERSHIP_PORT,
  type TelegramMembershipPort,
} from '../domain/telegram-membership.port';

/** Vigencia del rol cacheado (RNF-REN-03). Los eventos `chat_member` lo invalidan antes. */
export const MEMBERSHIP_TTL_MS = 10 * 60 * 1000;
const MEMBERSHIP_CACHE_MAX_ENTRIES = 1_000;

/**
 * Rol en vivo según Telegram (`getChatMember`), no según `group.members` en la BD.
 * Se cachea 10 min por usuario; `invalidate` la borra antes cuando Telegram avisa de
 * un cambio (`chat_member`) o cuando otro módulo lo cambia (admisión, T25).
 */
@Injectable()
export class MembershipService {
  private readonly roles = new TtlCache<number, Role>({
    ttlMs: MEMBERSHIP_TTL_MS,
    maxEntries: MEMBERSHIP_CACHE_MAX_ENTRIES,
  });

  constructor(
    @Inject(TELEGRAM_MEMBERSHIP_PORT)
    private readonly telegram: TelegramMembershipPort,
  ) {}

  getRole(telegramId: number): Promise<Role> {
    return this.roles.getOrLoad(telegramId, async () =>
      roleFromChatMember(await this.telegram.getChatMember(telegramId)),
    );
  }

  invalidate(telegramId: number): void {
    this.roles.delete(telegramId);
  }
}
