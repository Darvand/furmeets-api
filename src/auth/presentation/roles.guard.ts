import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipService } from 'src/membership/application/membership.service';
import { Role, Roles } from 'src/membership/domain/role';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';

const REQUIRED_ROLE_KEY = 'auth:requiredRole';

/**
 * Exige un rol en vivo (`MembershipService.resolveRole`, cacheado). Corre después de
 * `TmaAuthGuard`, así que `request.user` ya existe. Un rol distinto responde 403
 * (lo registra `ForbiddenLoggingFilter`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly membershipService: MembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<Role | undefined>(
      REQUIRED_ROLE_KEY,
      context.getHandler(),
    );
    if (!required) return true;
    const { user } = context.switchToHttp().getRequest<CustomRequest>();
    const role = await this.membershipService.resolveRole(user);
    if (role !== required) {
      throw new ForbiddenException(`Requires role ${required}`);
    }
    return true;
  }
}

/** Solo miembros del grupo (votar, listar solicitudes…). */
export const MembersOnly = () =>
  applyDecorators(
    SetMetadata(REQUIRED_ROLE_KEY, Roles.Member),
    UseGuards(RolesGuard),
  );

/** Solo solicitantes (crear su propia solicitud). */
export const ApplicantsOnly = () =>
  applyDecorators(
    SetMetadata(REQUIRED_ROLE_KEY, Roles.Applicant),
    UseGuards(RolesGuard),
  );
