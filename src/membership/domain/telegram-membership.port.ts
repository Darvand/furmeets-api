import { ChatMemberStatus } from './role';

export const TELEGRAM_MEMBERSHIP_PORT = Symbol('TelegramMembershipPort');

/** Consulta a Telegram el estado de un usuario en el grupo principal, sin caché. */
export interface TelegramMembershipPort {
  getChatMember(telegramId: number): Promise<ChatMemberStatus>;
}
