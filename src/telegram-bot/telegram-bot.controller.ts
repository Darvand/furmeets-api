import { Controller, Logger, UseGuards } from '@nestjs/common';
import { TelegramBotService } from './telegram-bot.service';
import { MessagePattern } from '@nestjs/microservices';
import { Context } from 'grammy';

@Controller()
export class TelegramBotController {
    private readonly logger = new Logger(TelegramBotController.name);

    constructor(
        private readonly bot: TelegramBotService,
    ) { }

    @MessagePattern({
        command: 'test',
        description: 'Testeando',
    })
    async getResults(ctx: Context) {
        return ctx.reply("Hola! El bot está funcionando correctamente.");
    }

    @MessagePattern({
        command: 'faq',
        description: 'Preguntas frecuentes',
    })
    async faq(ctx: Context) {
        return ctx.reply("Aquí están las preguntas frecuentes...");
    }
}