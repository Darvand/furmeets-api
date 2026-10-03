import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageEntity } from '../entities/request-chat-message.entity';

export interface RequestChatMessageRepository {
  /** Un mensaje nuevo es una sola inserción: los envíos concurrentes no se pisan. */
  insert(message: RequestChatMessageEntity): Promise<void>;
  /** Mensajes de una solicitud, del más antiguo al más reciente. */
  findByRequestChat(requestChatId: UUID): Promise<RequestChatMessageEntity[]>;
  /**
   * `user` leyó la solicitud hasta `at`: los mensajes de antes dejan de contar como no
   * leídos. Una operación; si ya había leído más adelante, no retrocede.
   */
  markReadUpTo(requestChatId: UUID, user: UserEntity, at: Date): Promise<void>;
}
