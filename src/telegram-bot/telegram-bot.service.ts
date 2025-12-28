import { Bot, webhookCallback } from 'grammy';
import { Command } from './telegram-bot.server';
import { Inject, Logger } from '@nestjs/common';
import telegramBotConfig from './telegram-bot.config';
import type { ConfigType } from '@nestjs/config';
import { inspect } from 'util';

export class TelegramBotService {
    private readonly bot: Bot;
    private readonly logger = new Logger(TelegramBotService.name);
    constructor(
        @Inject(telegramBotConfig.KEY)
        private readonly config: ConfigType<typeof telegramBotConfig>,
    ) {
        this.bot = new Bot(config.token);
    }

    start() {
        this.bot.on('message', async (ctx) => {
            this.logger.debug(
                `User with id ${ctx.message.from.id} sent a message: ${ctx.message.text}`,
            );
        });
        this.bot.on(':new_chat_members', async (ctx) => {
            this.logger.debug(
                `New members in chat ${ctx.chat.id}: ${inspect(ctx)}`,
            );
        })
        this.bot.catch((err) => {
            this.logger.error('Bot Error: ', err);
        });
        this.bot.start();
        this.logger.log('Bot started');
    }

    command(pattern: string, handler: (ctx: any) => void) {
        this.bot.command(pattern, handler);
    }

    stop() {
        this.bot.stop();
    }

    async setCommands(commands: Command[]) {
        await this.bot.api.setMyCommands(commands);
        this.logger.debug(`Commands set: ${inspect(commands)}`);
    }

    async getMemberFromGroup(telegramId: number) {
        return this.bot.api.getChatMember(this.config.mainChatId, telegramId);
    }

    async getBotMemberFromGroup() {
        const bot = await this.bot.api.getMe();
        return this.bot.api.getChatMember(this.config.mainChatId, bot.id);
    }

    async getProfilePhotoPath(telegramId: number): Promise<string | undefined> {
        const profilePhotos = await this.bot.api.getUserProfilePhotos(telegramId);
        if (profilePhotos.total_count === 0) {
            return undefined;
        }
        const photoSizes = profilePhotos.photos[0][2];
        const file = await this.bot.api.getFile(photoSizes.file_id);
        return file.file_path;
    }

    async isMember(telegramId: number): Promise<boolean> {
        const member = await this.getMemberFromGroup(telegramId);
        return member.status === 'member' || member.status === 'administrator' || member.status === 'creator';
    }

    async getProfilePhotoPathByFileId(fileId: string): Promise<string | undefined> {
        const file = await this.bot.api.getFile(fileId);
        return file.file_path;
    }

    async getGroup() {
        return this.bot.api.getChat(this.config.mainChatId);
    }

    async sendMessageToGroup(text: string): Promise<void> {
        await this.bot.api.sendMessage(this.config.mainChatId, text, {
            parse_mode: 'Markdown',
        });
    }

    async sendInviteLinkToUser(telegramId: number): Promise<void> {
        const inviteLink = await this.bot.api.createChatInviteLink(this.config.mainChatId, { member_limit: 1 });
        await this.bot.api.sendMessage(telegramId, `Aquí tienes tu enlace de invitación al grupo: ${inviteLink.invite_link}`, {
            parse_mode: 'Markdown',
        });
    }

    // middleware() {
    //     return webhookCallback(this.bot, 'express');
    // }
}