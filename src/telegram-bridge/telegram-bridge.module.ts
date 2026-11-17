import { Module } from '@nestjs/common';
import { MediaModule } from 'src/media/media.module';
import { TelegramBotModule } from 'src/telegram-bot/telegram-bot.module';
import { BridgeService } from './application/bridge.service';

/**
 * Puente con el grupo de Telegram. No importa `ChatModule`, que lo usa: quien lo llama
 * guarda lo que el puente devuelve.
 */
@Module({
  imports: [TelegramBotModule, MediaModule],
  providers: [BridgeService],
  exports: [BridgeService],
})
export class TelegramBridgeModule {}
