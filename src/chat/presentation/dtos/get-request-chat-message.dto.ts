import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

export class GetRequestChatMessageDto {
  uuid: string;
  /** Solicitud del mensaje: el cliente filtra los eventos por ella. */
  requestChatUUID: string;
  /**
   * El id que le puso el cliente a su envío, si lo envió. Viene en el ack, en el evento y
   * en el historial: tras reconectar, la App confirma con él sus mensajes pendientes.
   */
  clientMessageId?: string;
  /** Vacío si el mensaje es solo imágenes. */
  content: string;
  /** Se ven con `GET /media/:id`; falta si no tiene imágenes. */
  imageIds?: string[];
  /** El mensaje al que responde, citado como estaba al enviarlo. */
  replyTo?: {
    uuid: string;
    user: GetUserDto;
    /** Inicio del texto citado; vacío si era solo imágenes. */
    excerpt: string;
    hasImages: boolean;
  };
  user: GetUserDto;
  /** ISO-8601 UTC; el cliente lo formatea en su zona horaria. */
  sentAt: string;
}
