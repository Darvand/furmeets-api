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

    getAdmins() {
        return this.bot.api.getChatAdministrators(this.config.chatId);
    }

    async setCommands(commands: Command[]) {
        await this.bot.api.setMyCommands(commands);
        this.logger.debug(`Commands set: ${inspect(commands)}`);
    }

    // middleware() {
    //     return webhookCallback(this.bot, 'express');
    // }
}