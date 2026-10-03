import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { RequestChatAccessService } from '../application/request-chat-access.service';

/**
 * Permite la ruta a cualquier miembro o al dueño de la solicitud del parámetro `:id`.
 * Un solicitante que pide la solicitud de otro (o una que no existe) recibe 403, sin
 * revelar si existe. Corre antes del handler, así no hay efectos.
 */
@Injectable()
export class OwnerOrMemberGuard implements CanActivate {
  constructor(private readonly access: RequestChatAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomRequest>();
    const requestChatId = String(request.params.id ?? '');
    if (!(await this.access.canAccess(request.user, requestChatId))) {
      throw new ForbiddenException('Not the owner of this request chat');
    }
    return true;
  }
}

export const OwnerOrMember = () => UseGuards(OwnerOrMemberGuard);
