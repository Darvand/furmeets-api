import { Entity } from 'src/shared/domain/entities/entity';
import { RequestChatMessageEntity } from './request-chat-message.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  RequestChatState,
  RequestChatStateType,
} from '../value-objects/request-chat-state.value-object';
import { RequestChatVoteEntity } from './request-chat-vote.entity';
import { DateTime } from 'luxon';

const APPROVE_THRESHOLD = process.env.APPROVE_THRESHOLD || 5;
const REJECT_THRESHOLD = process.env.REJECT_THRESHOLD || 3;
const TELEGRAM_BOT_LINK =
  process.env.TELEGRAM_BOT_LINK || 't.me/furmeets_test_bot/furmeets_hub';
const WELCOME_MESSAGE_CONTENT =
  '¡Hola! En este chat podrás comunicarte con todos los miembros. Que tal si empiezas por presentarte y contarnos un poco sobre ti.';
const REJECTED_MESSAGE_CONTENT =
  'Lamentablemente tu solicitud ha sido rechazada. Si crees que se trata de un error, no dudes en contactarnos.';
const APPROVED_MESSAGE_CONTENT =
  '¡Felicidades! Tu solicitud ha sido aprobada. Te damos la bienvenida al grupo.';

/**
 * Solicitud de ingreso: solicitante, formulario, votos y estado. Los mensajes viven en su
 * propia colección (`RequestChatMessageEntity`); los de sistema los crea esta entidad.
 */
export interface RequestChatProps {
  requester: UserEntity;
  whereYouFoundUs?: string;
  interests?: string;
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

  static asNew(
    requester: UserEntity,
    interests?: string,
    whereYouFoundUs?: string,
  ): RequestChatEntity {
    return new RequestChatEntity({
      requester,
      interests,
      whereYouFoundUs,
      state: RequestChatState.InProgress(),
      createdAt: DateTime.now(),
      votes: [],
    });
  }

  /** Mensaje de bienvenida del bot con el que nace toda solicitud. */
  welcomeMessage(bot: UserEntity, at: Date): RequestChatMessageEntity {
    return this.systemMessage(bot, WELCOME_MESSAGE_CONTENT, at);
  }

  rejectedMessage(bot: UserEntity, at: Date): RequestChatMessageEntity {
    return this.systemMessage(bot, REJECTED_MESSAGE_CONTENT, at);
  }

  approvedMessage(bot: UserEntity, at: Date): RequestChatMessageEntity {
    return this.systemMessage(bot, APPROVED_MESSAGE_CONTENT, at);
  }

  /** Los mensajes del bot nacen sin leer, para que cuenten como no leídos. */
  private systemMessage(
    bot: UserEntity,
    content: string,
    at: Date,
  ): RequestChatMessageEntity {
    return RequestChatMessageEntity.create({
      requestChatId: this.id,
      author: bot,
      content,
      readBy: [],
      createdAt: at,
    });
  }

  announceWelcomeMesssage(): string {
    return (
      `🚨Nueva solicitud de ingreso🚨\n` +
      `Hay una nueva solicitud de parte de [${this.props.requester.name}](tg://user?id=${this.props.requester.telegramId}).\n` +
      `Pasate por el chat para conversar 💬, conocerlo mejor y considerar su ingreso al grupo.\n` +
      (this.props.whereYouFoundUs
        ? `*¿Dónde nos encontró?* ${this.props.whereYouFoundUs}\n`
        : '') +
      (this.props.interests
        ? `*¿Cuáles son sus intereses?* ${this.props.interests}\n`
        : '') +
      `Dirigite a este [link](${TELEGRAM_BOT_LINK}) para ver las peticiones.`
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

  addVote(vote: RequestChatVoteEntity): void {
    if (this.isSameVote(vote)) {
      this.props.votes = this.props.votes.filter((v) => !v.equals(vote));
      return;
    }
    this.props.votes = this.props.votes.filter((v) => !v.equals(vote));
    this.props.votes.push(vote);
    if (this.countApproves() >= +APPROVE_THRESHOLD) {
      this.props.state = RequestChatState.Approved();
      return;
    }
    if (this.countRejects() >= +REJECT_THRESHOLD) {
      this.props.state = RequestChatState.Rejected();
      return;
    }
  }

  private isSameVote(vote: RequestChatVoteEntity): boolean {
    const existingVote = this.props.votes.find((v) => v.equals(vote));
    return existingVote ? existingVote.props.type === vote.props.type : false;
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

  getNewMessageNotificationText(): string {
    return `${this.props.requester.name}, tienes un mensaje nuevo en el [chat](${TELEGRAM_BOT_LINK}).`;
  }
}
