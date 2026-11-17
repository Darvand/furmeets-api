import { Injectable } from '@nestjs/common';
import { requestChatDeepLink } from 'src/chat/domain/entities/request-chat.entity';
import { MediaService } from 'src/media/application/media.service';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { republicationOf } from '../domain/republication';

/** Un mensaje del solicitante, tal como se guardó. */
export interface MessageToRepublish {
  requestChatId: string;
  requesterName: string;
  content: string;
  /** Ids de `media` del mensaje. */
  imageIds: readonly string[];
}

/**
 * Puente entre el chat de una solicitud y el grupo de Telegram. Republica lo que escribe
 * el solicitante, con las imágenes reutilizando su `file_id` (sin volver a subirlas). No
 * guarda nada ni reintenta: quien lo llama lo corre en segundo plano y decide qué hacer
 * con un fallo, que nunca debe afectar al mensaje guardado.
 */
@Injectable()
export class BridgeService {
  constructor(
    private readonly telegram: TelegramBotService,
    private readonly media: MediaService,
  ) {}

  async republish(message: MessageToRepublish): Promise<void> {
    const fileIds = await this.media.fileIdsOf(message.imageIds);
    const { head, overflow } = republicationOf({
      requesterName: message.requesterName,
      link: requestChatDeepLink(message.requestChatId),
      content: message.content,
      hasImages: fileIds.length > 0,
    });
    if (fileIds.length) {
      await this.telegram.sendPhotosToGroup(fileIds, head.text, head.entities);
    } else {
      await this.telegram.sendTextToGroup(head.text, head.entities);
    }
    if (overflow) {
      await this.telegram.sendTextToGroup(overflow.text, overflow.entities);
    }
  }
}
