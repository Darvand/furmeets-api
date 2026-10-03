import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';

export class GetRequestChatMessageDto {
  uuid: string;
  /** Solicitud del mensaje: el cliente filtra los eventos por ella. */
  requestChatUUID: string;
  /**
   * Solo en el ack y en el evento de un mensaje recién enviado: el id que le puso el
   * cliente, para confirmar su mensaje optimista. Aún no se guarda (idempotencia: T16).
   */
  clientMessageId?: string;
  content: string;
  user: GetUserDto;
  /** ISO-8601 UTC; el cliente lo formatea en su zona horaria. */
  sentAt: string;
}
