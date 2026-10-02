import { Controller, Get, Post, Req } from '@nestjs/common';
import { GroupsService } from '../application/groups.service';
import { GroupMapper } from '../mappers/group.mapper';
import { GetGroupDto } from './dtos/get-group.dto';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { MembershipService } from 'src/membership/application/membership.service';
import { Roles } from 'src/membership/domain/role';

@Controller('groups')
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly membershipService: MembershipService,
  ) {}

  /** Nombre, foto y descripción para todos; la lista de miembros, solo para miembros. */
  @Get()
  async getGroup(@Req() req: CustomRequest): Promise<GetGroupDto> {
    const [group, role] = await Promise.all([
      this.groupsService.getGroup(),
      this.membershipService.resolveRole(req.user),
    ]);
    const dto = GroupMapper.toDto(group);
    return role === Roles.Member ? dto : { ...dto, members: [] };
  }

  /** @deprecated Arranque de la App actual; `GET /me` lo reemplaza (T07 deja de usarlo). */
  @Post('sync')
  async sync(@Req() req: CustomRequest): Promise<void> {
    await this.groupsService.sync(req.user);
  }
}
