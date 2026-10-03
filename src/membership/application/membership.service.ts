import { Inject, Injectable, Logger } from '@nestjs/common';
import { withDeadline } from 'src/shared/async/deadline';
import { TtlCache } from 'src/shared/cache/ttl-cache';
import { Role, Roles, roleFromChatMember } from '../domain/role';
import {
  TELEGRAM_MEMBERSHIP_PORT,
  type TelegramMembershipPort,
} from '../domain/telegram-membership.port';

/** Vigencia del rol cacheado (RNF-REN-03). Los eventos `chat_member` lo invalidan antes. */
export const MEMBERSHIP_TTL_MS = 10 * 60 * 1000;
const MEMBERSHIP_CACHE_MAX_ENTRIES = 1_000;

/**
 * Lo máximo que una petición espera el rol con la caché fría (RNF-REN-08). Si vence, se
 * usa la membresía guardada y la consulta termina de llenar la caché.
 */
export const MEMBERSHIP_DEADLINE_MS = 1_000;

/** Lo que hace falta de un usuario para resolver su rol. */
export interface MembershipSubject {
  telegramId: number;
  /** Última membresía conocida (guardada en la BD). */
  isMember: boolean;
}

/**
 * Rol en vivo según Telegram (`getChatMember`), no según `group.members` en la BD.
 * Se cachea 10 min por usuario; `invalidate` la borra antes cuando Telegram avisa de
 * un cambio (`chat_member`) o cuando otro módulo lo cambia (admisión, T25).
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);
  private readonly roles = new TtlCache<number, Role>({
    ttlMs: MEMBERSHIP_TTL_MS,
    maxEntries: MEMBERSHIP_CACHE_MAX_ENTRIES,
  });
  private readonly invalidationListeners: ((telegramId: number) => void)[] = [];

  constructor(
    @Inject(TELEGRAM_MEMBERSHIP_PORT)
    private readonly telegram: TelegramMembershipPort,
  ) {}

  getRole(telegramId: number): Promise<Role> {
    return this.roles.getOrLoad(telegramId, async () =>
      roleFromChatMember(await this.telegram.getChatMember(telegramId)),
    );
  }

  /**
   * Rol para decidir una petición. Con la caché fría espera a Telegram como máximo
   * `MEMBERSHIP_DEADLINE_MS`; si vence o falla, usa la última membresía guardada. Así la
   * App y la autorización siguen funcionando aunque Telegram tarde o esté caído.
   */
  async resolveRole(subject: MembershipSubject): Promise<Role> {
    try {
      return await withDeadline(
        this.getRole(subject.telegramId),
        MEMBERSHIP_DEADLINE_MS,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Rol de Telegram no disponible (${reason}); se usa la membresía guardada`,
      );
      return subject.isMember ? Roles.Member : Roles.Applicant;
    }
  }

  invalidate(telegramId: number): void {
    this.roles.delete(telegramId);
    for (const listener of this.invalidationListeners) {
      listener(telegramId);
    }
  }

  /** Avisa cuando se invalida el rol de un usuario (p. ej. para actualizar sus salas). */
  onInvalidate(listener: (telegramId: number) => void): void {
    this.invalidationListeners.push(listener);
  }
}
