import { Request } from 'express';
import { UserEntity } from 'src/members/domain/entities/user.entity';

/** Request de una ruta protegida: `TmaAuthGuard` deja aquí al usuario autenticado. */
export interface CustomRequest extends Request {
  user: UserEntity;
}
