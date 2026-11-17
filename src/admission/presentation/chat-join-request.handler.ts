import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  type ChatJoinRequestUpdate,
  TelegramBotService,
} from 'src/telegram-bot/telegram-bot.service';
import { AdmissionService } from '../application/admission.service';

/** Recibe los updates `chat_join_request` del bot y los pasa a `AdmissionService`. */
@Injectable()
export class ChatJoinRequestHandler implements OnModuleInit {
  private readonly logger = new Logger(ChatJoinRequestHandler.name);

  constructor(
    private readonly telegramBotService: TelegramBotService,
    private readonly admissionService: AdmissionService,
  ) {}

  onModuleInit(): void {
    this.telegramBotService.onChatJoinRequest((update) => this.handle(update));
  }

  async handle(update: ChatJoinRequestUpdate): Promise<void> {
    try {
      await this.admissionService.handleJoinRequest(update);
    } catch (error) {
      // La solicitud queda pendiente en Telegram: un admin la puede resolver a mano.
      this.logger.error(
        `Error al resolver una solicitud de unión: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
