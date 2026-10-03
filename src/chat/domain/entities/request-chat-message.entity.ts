import { UserEntity } from 'src/members/domain/entities/user.entity';
import { Entity } from 'src/shared/domain/entities/entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

export interface RequestChatMessageProps {
  requestChatId: UUID;
  author: UserEntity;
  content: string;
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

  /** Mensaje nuevo de `author`. */
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
      createdAt: at,
    });
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
