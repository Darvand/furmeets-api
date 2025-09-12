import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { TelegramBotService } from './telegram-bot.service';
import { Inject } from '@nestjs/common';
import telegramBotConfig from './telegram-bot.config';
import type { ConfigType } from '@nestjs/config';

export type Command = {
    command: string;
    description: string;
};

export class TelegramBotServer
    extends Server
    implements CustomTransportStrategy {
    constructor(
        private readonly bot: TelegramBotService,
        @Inject(telegramBotConfig.KEY)
        private readonly config: ConfigType<typeof telegramBotConfig>,
    ) {
        super();
    }

    async listen(callback: () => void) {
        await this.start(callback);
    }

    async start(callback: () => void) {
        await this.bindHandlers();
        this.bot.start();
        callback();
    }

    unwrap<T = never>(): T {
        throw new Error('Method not implemented.');
    }

    on(event: string, callback: Function) {
        throw new Error('Method not implemented.');
    }

    async bindHandlers(): Promise<void> {
        this.messageHandlers.forEach((handler, command) => {
            this.logger.log(`Handling command: ${command}`);
            const pattern = JSON.parse(command).command;
            this.bot.command(pattern, handler);
        });
        this.logger?.debug?.(`Bound ${this.messageHandlers.size} message handlers`);
        await this.bot.setCommands(
            Array.from(this.messageHandlers.keys()).map<Command>((command) =>
                JSON.parse(command),
            ),
        );
    }

    close() {
        this.logger.log('Closing bot');
        this.bot.stop();
    }
}