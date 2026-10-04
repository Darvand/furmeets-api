import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

/** Límite de un mensaje de Telegram: el texto se republica en el grupo. */
export const MAX_MESSAGE_LENGTH = 4096;

/** Evento `request-chat`. El autor es siempre el usuario del socket (RNF-SEG-02). */
export class CreateRequestChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'content must not be blank' })
  @MaxLength(MAX_MESSAGE_LENGTH)
  content: string;

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
