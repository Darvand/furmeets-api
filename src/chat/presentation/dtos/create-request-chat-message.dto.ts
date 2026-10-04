import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { MAX_MESSAGE_IMAGES } from 'src/chat/domain/entities/request-chat-message.entity';

/** Límite de un mensaje de Telegram: el texto se republica en el grupo. */
export const MAX_MESSAGE_LENGTH = 4096;

/**
 * Evento `request-chat`: texto, imágenes o ambos (el servicio exige al menos uno). El
 * autor es siempre el usuario del socket (RNF-SEG-02).
 */
export class CreateRequestChatMessageDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'content must not be blank' })
  @MaxLength(MAX_MESSAGE_LENGTH)
  content?: string;

  /** Ids devueltos por `POST /media`, subidos por el mismo autor. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MESSAGE_IMAGES)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  imageIds?: string[];

  @IsUUID()
  requestChatUUID: string;

  /**
   * Id que genera el cliente para su envío; vuelve en el ack y el evento. Reenviar con el
   * mismo id devuelve el mensaje ya guardado, sin duplicarlo (RNF-CON-02).
   */
  @IsOptional()
  @IsUUID()
  clientMessageId?: string;
}
