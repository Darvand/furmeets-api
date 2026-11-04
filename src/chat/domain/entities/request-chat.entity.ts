import { Entity } from 'src/shared/domain/entities/entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  RequestChatState,
  RequestChatStateType,
} from '../value-objects/request-chat-state.value-object';
import { type VoteThresholds, Votes } from 'src/review/domain/vote';
import type { Endorsement } from 'src/review/domain/endorsement';
import { DateTime } from 'luxon';
import { ApplicationForm } from 'src/applications/domain/application-form';
import type { LegacyApplication } from 'src/applications/domain/legacy-application';

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

/** Quien vota o avala es el solicitante: nadie revisa su propia solicitud (SPEC §3.3). */
export class CannotReviewOwnRequestError extends Error {
  constructor(readonly requestChatId: UUID) {
    super(`Cannot review own request chat ${requestChatId.value}`);
    this.name = CannotReviewOwnRequestError.name;
  }
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
  votes: Votes;
  /** Uno por miembro, del más antiguo al más reciente. */
  endorsements: Endorsement[];
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
      votes: Votes.none(),
      endorsements: [],
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
   * Quién puede votar o avalar (SPEC §3.3): nadie revisa su propia solicitud
   * (`CannotReviewOwnRequestError`), y solo mientras está en curso (`RequestChatClosedError`):
   * cerrada, la revisión queda como estaba. Que sea miembro lo decide la ruta
   * (`@MembersOnly()`).
   */
  static assertAcceptsReviewFrom(
    requestChat: { id: UUID; requesterId: UUID; state: RequestChatStateType },
    member: UUID,
  ): void {
    if (member.equals(requestChat.requesterId)) {
      throw new CannotReviewOwnRequestError(requestChat.id);
    }
    RequestChatEntity.assertAcceptsMessages(requestChat.id, requestChat.state);
  }

  /**
   * Anuncio de la solicitud en el grupo. Solo lleva las líneas con valor. La etiqueta
   * "Menor de edad" no va aquí: se muestra en el Resumen de la App.
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
   * Estado al que pasa una solicitud en curso con estos votos, si alcanzaron un umbral.
   * Se evalúa con los votos ya guardados, que incluyen los de otros miembros que votaron
   * al mismo tiempo.
   */
  static outcomeFor(
    votes: Votes,
    thresholds: VoteThresholds,
  ): RequestChatState | undefined {
    switch (votes.winner(thresholds)) {
      case 'approve':
        return RequestChatState.Approved();
      case 'reject':
        return RequestChatState.Rejected();
      default:
        return undefined;
    }
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

  get votes(): Votes {
    return this.props.votes;
  }

  get endorsements(): readonly Endorsement[] {
    return this.props.endorsements;
  }

  get state(): RequestChatStateType {
    return this.props.state.props.value;
  }

  get id(): UUID {
    return this._id;
  }
}
