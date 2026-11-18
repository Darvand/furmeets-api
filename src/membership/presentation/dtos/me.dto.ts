import type { RequestChatStateType } from 'src/chat/domain/value-objects/request-chat-state.value-object';
import { GetUserDto } from 'src/members/presentation/dtos/get-user.dto';
import type { Role } from '../../domain/role';

/** Respuesta de `GET /me`: todo lo que la App necesita para enrutar al abrir (SPEC §1). */
export class MeDto {
  user: GetUserDto;
  role: Role;
  /** Solo para solicitantes que ya enviaron su solicitud. */
  requestChatId?: string;
  /** Estado de esa solicitud: enruta a su chat, a Aprobado o a No aprobado. */
  requestChatState?: RequestChatStateType;
  /**
   * Enlace de admisión, para la pantalla Aprobado. Solo si la solicitud está aprobada y
   * todavía no entró; falta también mientras se crea o si la aprobación es anterior a T25.
   */
  inviteLink?: string;
}
