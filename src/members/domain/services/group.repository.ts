import { UserEntity } from '../entities/user.entity';
import { GroupEntity } from '../entities/group.entity';

export interface GroupRepository {
  getGroup(): Promise<GroupEntity>;
  /**
   * Agrega o quita al usuario de los miembros con una operación atómica.
   * Devuelve `false` si el grupo aún no existe en la BD.
   */
  setMember(user: UserEntity, isMember: boolean): Promise<boolean>;
  /**
   * Copia de Telegram el nombre, la descripción y la foto del grupo (lo crea si no
   * existe). No toca los miembros.
   */
  refreshFromTelegram(): Promise<void>;
}
