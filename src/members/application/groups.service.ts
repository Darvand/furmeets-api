import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MEMBERS_PROVIDERS } from '../members.providers';
import type { GroupRepository } from '../domain/services/group.repository';
import { GroupEntity } from '../domain/entities/group.entity';
import { UserEntity } from '../domain/entities/user.entity';
import { UserService } from './user.service';
import { TELEGRAM_CACHE_TTL_MS } from 'src/telegram-bot/telegram-bot.service';
import { MembershipService } from 'src/membership/application/membership.service';
import { Roles } from 'src/membership/domain/role';
import { BackgroundRefresh } from 'src/shared/async/background-refresh';

@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);
  private readonly background = new BackgroundRefresh(
    TELEGRAM_CACHE_TTL_MS,
    this.logger,
  );

  constructor(
    @Inject(MEMBERS_PROVIDERS.GroupRepository)
    private readonly groupRepository: GroupRepository,
    private readonly userService: UserService,
    private readonly membershipService: MembershipService,
  ) {}

  async getGroup(): Promise<GroupEntity> {
    const group = await this.groupRepository.getGroup();
    if (!group) {
      throw new NotFoundException(`Group not found`);
    }
    return group;
  }

  /**
   * Sincroniza la membresía del usuario autenticado y la devuelve. Solo espera el rol
   * (cacheado en `MembershipService`) y escrituras atómicas en Mongo; la foto y la info
   * del grupo se refrescan en segundo plano, como máximo una vez por TTL (RNF-REN-03,
   * REN-08).
   */
  async sync(user: UserEntity): Promise<boolean> {
    const isMember =
      (await this.membershipService.resolveRole(user)) === Roles.Member;
    const [groupExists] = await Promise.all([
      this.groupRepository.setMember(user, isMember),
      this.userService.updateMembership(user, isMember),
    ]);
    if (!groupExists) {
      // Primer arranque: no hay grupo guardado, así que esta única vez se espera a Telegram.
      await this.groupRepository.refreshFromTelegram();
      await this.groupRepository.setMember(user, isMember);
    }
    void this.refreshInBackground(user);
    return isMember;
  }

  /**
   * Programa los refrescos que ninguna petición espera. Devuelve sus promesas solo para
   * que las pruebas puedan esperarlas.
   */
  refreshInBackground(user: UserEntity): Promise<void[]> {
    return Promise.all(
      [
        this.background.schedule('group', () =>
          this.groupRepository.refreshFromTelegram(),
        ),
        this.background.schedule(`avatar:${user.telegramId}`, () =>
          this.userService.refreshAvatar(user),
        ),
      ].filter((task): task is Promise<void> => task !== undefined),
    );
  }
}
