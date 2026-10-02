import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageEntity } from '../entities/request-chat-message.entity';

export interface RequestChatMessageRepository {
  /** Un mensaje nuevo es una sola inserción: los envíos concurrentes no se pisan. */
  insert(message: RequestChatMessageEntity): Promise<void>;
  /** Mensajes de una solicitud, del más antiguo al más reciente. */
  findByRequestChat(requestChatId: UUID): Promise<RequestChatMessageEntity[]>;
  /** Mensajes de varias solicitudes en una consulta, agrupados por id de solicitud. */
  findByRequestChats(
    requestChatIds: UUID[],
  ): Promise<Map<string, RequestChatMessageEntity[]>>;
  /** Marca como leídos por `user` todos los mensajes de la solicitud que no había leído. */
  markAllReadBy(requestChatId: UUID, user: UserEntity, at: Date): Promise<void>;
}
