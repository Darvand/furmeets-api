import { UserEntity } from 'src/members/domain/entities/user.entity';
import { Entity } from 'src/shared/domain/entities/entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

/** Quién leyó un mensaje y cuándo. */
export interface MessageRead {
  userId: string;
  at: Date;
}

export interface RequestChatMessageProps {
  requestChatId: UUID;
  author: UserEntity;
  content: string;
  readBy: MessageRead[];
  /** Lo fija el servidor al persistir y no cambia después (deuda #5). */
  createdAt: Date;
}

/**
 * Mensaje del chat de una solicitud. Vive en su propia colección, no dentro de la
 * solicitud (ADR-001, regla 4): enviar un mensaje es una inserción, no reescribir la
 * solicitud completa.
 */
export class RequestChatMessageEntity extends Entity<RequestChatMessageProps> {
  private constructor(props: RequestChatMessageProps, id?: UUID) {
    super(props, id);
  }

  static create(
    props: RequestChatMessageProps,
    id?: UUID,
  ): RequestChatMessageEntity {
    return new RequestChatMessageEntity(props, id);
  }

  /** Mensaje nuevo: su autor ya lo leyó. */
  static send(
    requestChatId: UUID,
    author: UserEntity,
    content: string,
    at: Date,
  ): RequestChatMessageEntity {
    return new RequestChatMessageEntity({
      requestChatId,
      author,
      content,
      readBy: [{ userId: author.id.value, at }],
      createdAt: at,
    });
  }

  /** Marca el mensaje como leído por `user`. Devuelve si cambió. */
  markReadBy(user: UserEntity, at: Date): boolean {
    if (this.isReadBy(user)) {
      return false;
    }
    this.props.readBy.push({ userId: user.id.value, at });
    return true;
  }

  isReadBy(user: UserEntity): boolean {
    return this.props.readBy.some((read) => read.userId === user.id.value);
  }

  fromUser(user: UserEntity): boolean {
    return this.props.author.equals(user);
  }

  get id(): UUID {
    return this._id;
  }

  get requestChatId(): UUID {
    return this.props.requestChatId;
  }

  get author(): UserEntity {
    return this.props.author;
  }

  get content(): string {
    return this.props.content;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
