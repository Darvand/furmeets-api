import { Bot, InputFile } from 'grammy';
import type { CommandContext, Context } from 'grammy';
import { Command } from './telegram-bot.server';
import { Inject, Logger } from '@nestjs/common';
import telegramBotConfig from './telegram-bot.config';
import type { ConfigType } from '@nestjs/config';
import { inspect } from 'util';
import { telegramTimingTransformer } from '../shared/timing/telegram-timing';
import type {
  ChatFullInfo,
  ChatMember,
  PhotoSize,
  UserFromGetMe,
} from 'grammy/types';
import { TtlCache } from '../shared/cache/ttl-cache';

/** Vigencia de lo que se cachea de Telegram (RNF-REN-03). */
export const TELEGRAM_CACHE_TTL_MS = 10 * 60 * 1000;
const TELEGRAM_CACHE_MAX_ENTRIES = 1_000;

/** Lado mínimo de la foto de avatar: la App los muestra a 48–96 px. */
export const AVATAR_MIN_SIZE_PX = 160;

/**
 * Elige el tamaño más pequeño que sirva como avatar (no el de 640 px). Telegram no
 * garantiza cuántos tamaños trae una foto: si ninguno alcanza el mínimo, usa el más grande.
 */
export function pickAvatarSize(sizes: PhotoSize[]): PhotoSize | undefined {
  const bySide = [...sizes].sort(
    (a, b) => Math.min(a.width, a.height) - Math.min(b.width, b.height),
  );
  return (
    bySide.find(
      (size) => Math.min(size.width, size.height) >= AVATAR_MIN_SIZE_PX,
    ) ?? bySide.at(-1)
  );
}

/** Falta `TELEGRAM_STORAGE_CHAT_ID`: no hay dónde guardar imágenes subidas. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super('TELEGRAM_STORAGE_CHAT_ID is not configured');
  }
}

/** Un cambio de estado de un usuario en un chat (update `chat_member`). */
export interface ChatMemberUpdate {
  chatId: number;
  userId: number;
  status: string;
}

/**
 * Updates que recibe el bot. `chat_member` no llega por defecto: hay que pedirlo, y el
 * bot debe ser administrador del grupo para recibirlo.
 */
export const ALLOWED_UPDATES = ['message', 'chat_member'] as const;

/**
 * Adaptador de Telegram. Grupo y fotos se cachean en memoria por `TELEGRAM_CACHE_TTL_MS`,
 * y la info del bot sale de `bot.botInfo`, que grammY obtiene una sola vez al iniciar
 * (`getMe` no se vuelve a llamar). La membresía no se cachea aquí: la cachea
 * `MembershipService`, que además la invalida con los updates `chat_member`.
 */
export class TelegramBotService {
  private readonly bot: Bot;
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly profilePhotos = new TtlCache<number, PhotoSize | null>({
    ttlMs: TELEGRAM_CACHE_TTL_MS,
    maxEntries: TELEGRAM_CACHE_MAX_ENTRIES,
  });
  private readonly group = new TtlCache<'group', ChatFullInfo>({
    ttlMs: TELEGRAM_CACHE_TTL_MS,
    maxEntries: 1,
  });
  constructor(
    @Inject(telegramBotConfig.KEY)
    private readonly config: ConfigType<typeof telegramBotConfig>,
  ) {
    this.bot = new Bot(config.token);
    this.bot.api.config.use(telegramTimingTransformer);
  }

  start() {
    this.bot.on('message', (ctx) => {
      this.logger.debug(
        `User with id ${ctx.message.from.id} sent a message: ${ctx.message.text}`,
      );
    });
    this.bot.on(':new_chat_members', (ctx) => {
      this.logger.debug(`New members in chat ${ctx.chat.id}: ${inspect(ctx)}`);
    });
    this.bot.catch((err) => {
      this.logger.error('Bot Error: ', err);
    });
    void this.bot.start({ allowed_updates: ALLOWED_UPDATES });
    this.logger.log('Bot started');
  }

  command(pattern: string, handler: (ctx: CommandContext<Context>) => unknown) {
    this.bot.command(pattern, handler);
  }

  stop() {
    void this.bot.stop();
  }

  async setCommands(commands: Command[]) {
    await this.bot.api.setMyCommands(commands);
    this.logger.debug(`Commands set: ${inspect(commands)}`);
  }

  /** Info del bot. Tras el arranque no llama a Telegram; `init` comparte la llamada en curso. */
  async getBotInfo(): Promise<UserFromGetMe> {
    await this.bot.init();
    return this.bot.botInfo;
  }

  async getMemberFromGroup(telegramId: number): Promise<ChatMember> {
    return this.bot.api.getChatMember(this.config.mainChatId, telegramId);
  }

  /** Registra un handler para los updates `chat_member`. Llamar antes de `start`. */
  onChatMember(handler: (update: ChatMemberUpdate) => void): void {
    this.bot.on('chat_member', (ctx) => {
      handler({
        chatId: ctx.chatMember.chat.id,
        userId: ctx.chatMember.new_chat_member.user.id,
        status: ctx.chatMember.new_chat_member.status,
      });
    });
  }

  /** Tamaño de avatar de la foto de perfil actual (`undefined` si no tiene). */
  async getProfilePhoto(telegramId: number): Promise<PhotoSize | undefined> {
    const photo = await this.profilePhotos.getOrLoad(telegramId, async () => {
      const profilePhotos = await this.bot.api.getUserProfilePhotos(
        telegramId,
        { limit: 1 },
      );
      return pickAvatarSize(profilePhotos.photos[0] ?? []) ?? null;
    });
    return photo ?? undefined;
  }

  /**
   * Sube una imagen al canal de almacenamiento (`sendPhoto`) y devuelve su tamaño más
   * grande. Telegram la recomprime a JPEG.
   */
  async uploadPhotoToStorage(photo: Buffer): Promise<PhotoSize> {
    if (!this.config.storageChatId) {
      throw new StorageNotConfiguredError();
    }
    const message = await this.bot.api.sendPhoto(
      this.config.storageChatId,
      new InputFile(photo),
      {
        disable_notification: true,
      },
    );
    const largest = message.photo.at(-1);
    if (!largest) {
      throw new Error('Telegram did not return the uploaded photo');
    }
    return largest;
  }

  /** `file_path` de un archivo (vale al menos 1 h; quien llama decide si lo cachea). */
  async getFilePath(fileId: string): Promise<string> {
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) {
      throw new Error('Telegram returned no file_path');
    }
    return file.file_path;
  }

  /**
   * Descarga un archivo de Telegram. La URL lleva el token del bot, así que no sale de
   * aquí: ni en la respuesta ni en los errores (RNF-SEG-03).
   */
  async downloadFile(filePath: string): Promise<Response> {
    try {
      return await fetch(
        `https://api.telegram.org/file/bot${this.config.token}/${filePath}`,
      );
    } catch {
      throw new Error('Telegram file download failed');
    }
  }

  async getGroup(): Promise<ChatFullInfo> {
    return this.group.getOrLoad('group', () =>
      this.bot.api.getChat(this.config.mainChatId),
    );
  }

  async sendMessageToGroup(text: string): Promise<void> {
    await this.bot.api.sendMessage(this.config.mainChatId, text, {
      parse_mode: 'Markdown',
    });
  }

  async sendMessageToUser(telegramId: number, text: string): Promise<void> {
    await this.bot.api.sendMessage(telegramId, text, {
      parse_mode: 'Markdown',
    });
  }

  async sendInviteLinkToUser(telegramId: number): Promise<void> {
    const inviteLink = await this.bot.api.createChatInviteLink(
      this.config.mainChatId,
      { member_limit: 1 },
    );
    await this.bot.api.sendMessage(
      telegramId,
      `Aquí tienes tu enlace de invitación al grupo: ${inviteLink.invite_link}`,
      {
        parse_mode: 'Markdown',
      },
    );
  }

  // middleware() {
  //     return webhookCallback(this.bot, 'express');
  // }
}
