import { Entity } from 'src/shared/domain/entities/entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  RequestChatState,
  RequestChatStateType,
} from '../value-objects/request-chat-state.value-object';
import { RequestChatVoteEntity } from './request-chat-vote.entity';
import { DateTime } from 'luxon';
import { ApplicationForm } from 'src/applications/domain/application-form';
import type { LegacyApplication } from 'src/applications/domain/legacy-application';

const APPROVE_THRESHOLD = process.env.APPROVE_THRESHOLD || 5;
const REJECT_THRESHOLD = process.env.REJECT_THRESHOLD || 3;
const TELEGRAM_BOT_LINK =
  process.env.TELEGRAM_BOT_LINK || 't.me/furmeets_test_bot/furmeets_hub';

/**
 * Contenido máximo de un mensaje reenviado al grupo. Telegram acepta hasta 4096
 * caracteres y el aviso suma encabezado y enlace.
 */
const GROUP_NOTICE_MAX_CONTENT = 3_500;

/**
 * Escapa texto de usuario para `parse_mode: 'Markdown'`: un `*`, `_`, `` ` `` o `[`
 * suelto hace que Telegram rechace el mensaje entero.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[]/g, '\\$&');
}

/** La solicitud ya se cerró: su chat es de solo lectura. */
export class RequestChatClosedError extends Error {
  constructor(readonly requestChatId: UUID) {
    super(`Request chat ${requestChatId.value} is closed`);
    this.name = RequestChatClosedError.name;
  }
}

export type VoteType = 'approve' | 'reject';

/** Conteos de votos de una solicitud. */
export interface VoteTally {
  approved: number;
  rejected: number;
}

/**
 * Solicitud de ingreso: solicitante, formulario, votos y estado. Los mensajes viven en su
 * propia colección (`RequestChatMessageEntity`) y son todos del solicitante o de miembros:
 * el bot no escribe en el chat (SPEC §3.2).
 */
export interface RequestChatProps {
  requester: UserEntity;
  /** Falta en las solicitudes anteriores al formulario actual: esas llevan `legacy`. */
  form?: ApplicationForm;
  /** Solicitud anterior al formulario actual (`legacy: true`), con sus respuestas. */
  legacy?: LegacyApplication;
  state: RequestChatState;
  createdAt: DateTime;
  votes: RequestChatVoteEntity[];
}

export class RequestChatEntity extends Entity<RequestChatProps> {
  private constructor(props: RequestChatProps, id?: UUID) {
    super(props, id);
  }
  static create(props: RequestChatProps, id?: UUID): RequestChatEntity {
    return new RequestChatEntity(props, id);
  }

  /** Solicitud nueva a partir del formulario enviado por `requester`. */
  static apply(
    requester: UserEntity,
    form: ApplicationForm,
  ): RequestChatEntity {
    return new RequestChatEntity({
      requester,
      form,
      state: RequestChatState.InProgress(),
      createdAt: DateTime.now(),
      votes: [],
    });
  }

  /**
   * Tras el cierre (aprobada o rechazada) el chat queda en solo lectura (SPEC §3.2):
   * cualquier envío se rechaza.
   */
  static assertAcceptsMessages(id: UUID, state: RequestChatStateType): void {
    if (state !== RequestChatState.InProgress().props.value) {
      throw new RequestChatClosedError(id);
    }
  }

  /**
   * Anuncio de la solicitud en el grupo. Solo lleva las líneas con valor. La etiqueta
   * "Menor de edad" no va aquí: se muestra en señales y comentarios de la App.
   */
  announceWelcomeMesssage(): string {
    const form = this.props.form?.props;
    const legacy = this.props.legacy;
    const line = (label: string, value?: string | number) =>
      value === undefined || value === ''
        ? ''
        : `*${label}* ${escapeMarkdown(String(value))}\n`;
    return (
      `🚨Nueva solicitud de ingreso🚨\n` +
      `Hay una nueva solicitud de parte de [${escapeMarkdown(this.props.requester.name)}](tg://user?id=${this.props.requester.telegramId}).\n` +
      `Pasate por el chat para conversar 💬, conocerlo mejor y considerar su ingreso al grupo.\n` +
      line('Edad:', form?.age) +
      line('Ciudad:', form?.city) +
      line('Fursona:', form?.fursonaName) +
      line('Especie:', form?.species) +
      line(
        '¿Cómo conoció FurMeets?',
        form?.howDidYouFindUs ?? legacy?.howDidYouFindUs,
      ) +
      line('¿Cuáles son sus intereses?', legacy?.interests) +
      `[Ver solicitud](${TELEGRAM_BOT_LINK}?startapp=${this.id.value})`
    );
  }

  announceApproval(): string {
    return (
      `✅ La solicitud de [${this.props.requester.name}](tg://user?id=${this.props.requester.telegramId}) ha sido aprobada.\n` +
      `¡Te damos la bienvenida al grupo! 🎉`
    );
  }

  announceRejection(): string {
    return (
      `❌ La solicitud de [${this.props.requester.name}](tg://user?id=${this.props.requester.telegramId}) ha sido rechazada.\n` +
      `Lo sentimos, no ha sido posible aceptar su ingreso en este momento.`
    );
  }

  /**
   * Estado al que pasa una solicitud en curso con estos conteos, si alcanzó un umbral.
   * Se evalúa con los votos ya guardados, que incluyen los de otros miembros que votaron
   * al mismo tiempo.
   */
  static outcomeFor(votes: VoteTally): RequestChatState | undefined {
    if (votes.approved >= +APPROVE_THRESHOLD) {
      return RequestChatState.Approved();
    }
    if (votes.rejected >= +REJECT_THRESHOLD) {
      return RequestChatState.Rejected();
    }
    return undefined;
  }

  /**
   * Mensaje del solicitante reenviado al grupo: quién escribe, el contenido y el enlace
   * a su solicitud en la MiniApp (`startapp` lleva el id de la solicitud).
   */
  static requesterMessageNotice(
    requestChatId: UUID,
    requester: UserEntity,
    content: string,
  ): string {
    const excerpt =
      content.length > GROUP_NOTICE_MAX_CONTENT
        ? `${content.slice(0, GROUP_NOTICE_MAX_CONTENT)}…`
        : content;
    return (
      `💬 Nuevo mensaje de *${escapeMarkdown(requester.name)}* en su solicitud:\n` +
      `${escapeMarkdown(excerpt)}\n` +
      `[Ver solicitud](${TELEGRAM_BOT_LINK}?startapp=${requestChatId.value})`
    );
  }

  /** Aviso al solicitante de que tiene un mensaje nuevo. */
  static newMessageNotificationText(requester: UserEntity): string {
    return `${requester.name}, tienes un mensaje nuevo en el [chat](${TELEGRAM_BOT_LINK}).`;
  }

  isApproved(): boolean {
    return this.props.state.isApproved();
  }

  isRejected(): boolean {
    return this.props.state.isRejected();
  }

  isInProgress(): boolean {
    return !this.isApproved() && !this.isRejected();
  }

  countApproves(): number {
    return this.props.votes.filter((vote) => vote.isApprove()).length;
  }

  countRejects(): number {
    return this.props.votes.filter((vote) => vote.isReject()).length;
  }

  getUserVoteType(user: UserEntity): 'approve' | 'reject' | undefined {
    const vote = this.props.votes.find(
      (v) => v.props.user.id.value === user.id.value,
    );
    return vote ? vote.props.type : undefined;
  }

  get state(): RequestChatStateType {
    return this.props.state.props.value;
  }

  get id(): UUID {
    return this._id;
  }
}
