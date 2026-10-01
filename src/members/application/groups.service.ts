import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { MEMBERS_PROVIDERS } from "../members.providers";
import type { GroupRepository } from "../domain/services/group.repository";
import { GroupEntity } from "../domain/entities/group.entity";
import { UserEntity } from "../domain/entities/user.entity";
import { UserService } from "./user.service";
import { TELEGRAM_CACHE_TTL_MS, TelegramBotService } from "src/telegram-bot/telegram-bot.service";
import { withDeadline } from "src/shared/async/deadline";
import { BackgroundRefresh } from "src/shared/async/background-refresh";

/**
 * Lo máximo que una petición espera la membresía con la caché fría (RNF-REN-08). Si
 * vence, se usa la membresía guardada y la consulta termina de llenar la caché.
 */
export const MEMBERSHIP_DEADLINE_MS = 1_000;

@Injectable()
export class GroupsService {

    private readonly logger = new Logger(GroupsService.name);
    private readonly background = new BackgroundRefresh(TELEGRAM_CACHE_TTL_MS, this.logger);

    constructor(
        @Inject(MEMBERS_PROVIDERS.GroupRepository) private readonly groupRepository: GroupRepository,
        private readonly userService: UserService,
        private readonly telegramBotService: TelegramBotService,
    ) { }

    async getGroup(): Promise<GroupEntity> {
        const group = await this.groupRepository.getGroup();
        if (!group) {
            throw new NotFoundException(`Group not found`);
        }
        return group;
    }

    /**
     * Sincroniza la membresía del usuario autenticado. Solo espera la membresía (cacheada)
     * y escrituras atómicas en Mongo; fotos, info del grupo y usuario del bot se refrescan
     * en segundo plano, como máximo una vez por TTL (RNF-REN-03, REN-08).
     */
    async sync(user: UserEntity): Promise<void> {
        const isMember = await this.resolveMembership(user);
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
    }

    /**
     * Programa los refrescos que ninguna petición espera. Devuelve sus promesas solo para
     * que las pruebas puedan esperarlas.
     */
    refreshInBackground(user: UserEntity): Promise<void[]> {
        return Promise.all(
            [
                this.background.schedule('group', () => this.groupRepository.refreshFromTelegram()),
                this.background.schedule('bot-user', () => this.userService.refreshBotUser()),
                this.background.schedule(`avatar:${user.telegramId}`, () => this.userService.refreshAvatar(user)),
            ].filter((task): task is Promise<void> => task !== undefined),
        );
    }

    private async resolveMembership(user: UserEntity): Promise<boolean> {
        try {
            return await withDeadline(this.telegramBotService.isMember(user.telegramId), MEMBERSHIP_DEADLINE_MS);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Membresía de Telegram no disponible (${reason}); se usa la guardada`);
            return user.isMember;
        }
    }
}
