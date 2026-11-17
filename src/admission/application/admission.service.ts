import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import {
  type ChatJoinRequestUpdate,
  TelegramBotService,
} from 'src/telegram-bot/telegram-bot.service';
import { MembershipService } from 'src/membership/application/membership.service';
import { UserService } from 'src/members/application/user.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  admissionLinkName,
  decideJoinRequest,
  needsInviteLink,
  pendingInviteLink,
} from '../domain/admission';
import {
  ADMISSION_REPOSITORY,
  type AdmissionRepository,
} from '../domain/admission.repository';

/**
 * Admisión al grupo por solicitud de unión (SPEC §3.4, T25). Cada aprobado recibe un
 * enlace propio que no deja entrar a nadie directamente: el bot acepta la solicitud de
 * unión solo si viene del aprobado y por ese enlace, y lo revoca en cuanto entra.
 */
@Injectable()
export class AdmissionService {
  private readonly logger = new Logger(AdmissionService.name);

  constructor(
    @Inject(ADMISSION_REPOSITORY)
    private readonly admissions: AdmissionRepository,
    private readonly telegram: TelegramBotService,
    private readonly membership: MembershipService,
    private readonly users: UserService,
    @Inject(telegramBotConfig.KEY)
    private readonly config: ConfigType<typeof telegramBotConfig>,
  ) {}

  /**
   * Crea y guarda el enlace de una solicitud aprobada, y lo devuelve. Se puede repetir sin
   * efectos: si ya tiene enlace, no crea otro. Devuelve `undefined` si la solicitud no lo
   * necesita (no está aprobada o ya entró). Si falla crear o guardar, lanza, para que
   * quien llama reintente.
   */
  async issueInviteLink(requestChatId: UUID): Promise<string | undefined> {
    const admission = await this.admissions.findById(requestChatId);
    const existing = pendingInviteLink(admission);
    if (existing || !needsInviteLink(admission)) {
      return existing;
    }
    return this.createInviteLink(requestChatId);
  }

  /** El enlace que el solicitante todavía puede usar, para la pantalla *Aprobado*. */
  async inviteLinkOf(requesterId: UUID): Promise<string | undefined> {
    return pendingInviteLink(
      await this.admissions.findByRequester(requesterId),
    );
  }

  /**
   * Acepta o rechaza una solicitud de unión al grupo principal. Al aceptar, marca que
   * entró, invalida su rol cacheado (RNF-SEG-10) y revoca el enlace.
   */
  async handleJoinRequest(update: ChatJoinRequestUpdate): Promise<void> {
    if (String(update.chatId) !== this.config.mainChatId) {
      return;
    }
    const user = await this.users.getUserByTelegramId(update.userId);
    const admission = user
      ? await this.admissions.findByRequester(user.id)
      : null;
    const decision = decideJoinRequest(admission, update.inviteLink);
    if (!decision.approve) {
      this.logger.log(`Solicitud de unión rechazada (${decision.reason})`);
      await this.telegram.declineJoinRequest(update.userId);
      return;
    }
    const { requestChatId, inviteLink } = decision.admission;
    await this.telegram.approveJoinRequest(update.userId);
    await this.admissions.markAdmitted(requestChatId, new Date());
    this.membership.invalidate(update.userId);
    this.logger.log('Solicitud de unión aceptada');
    try {
      await this.telegram.revokeInviteLink(inviteLink);
    } catch (error) {
      // Ya entró y quedó marcado: aunque el enlace siga vivo, nadie más pasa con él.
      this.logger.warn(
        `No se pudo revocar el enlace de admisión: ${reason(error)}`,
      );
    }
  }

  /** Crea el enlace y lo guarda. Si otro proceso guardó uno antes, revoca el creado. */
  private async createInviteLink(
    requestChatId: UUID,
  ): Promise<string | undefined> {
    const created = await this.telegram.createAdmissionLink(
      admissionLinkName(requestChatId),
    );
    if (!created) {
      throw new Error('Telegram no devolvió el enlace de admisión');
    }
    if (await this.admissions.saveInviteLink(requestChatId, created)) {
      return created;
    }
    try {
      await this.telegram.revokeInviteLink(created);
    } catch (error) {
      this.logger.warn(
        `No se pudo revocar un enlace sobrante: ${reason(error)}`,
      );
    }
    return pendingInviteLink(await this.admissions.findById(requestChatId));
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
