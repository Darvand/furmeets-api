import { UserEntity } from 'src/members/domain/entities/user.entity';
import { Entity } from 'src/shared/domain/entities/entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

export interface RequestChatMessageProps {
  requestChatId: UUID;
  author: UserEntity;
  content: string;
  /** Lo fija el servidor al persistir y no cambia después (deuda #5). */
  createdAt: Date;
  /**
   * Id que le puso el cliente a su envío. Un reenvío con el mismo id y autor en la misma
   * solicitud devuelve este mensaje en vez de crear otro (RNF-CON-02).
   */
  clientMessageId?: string;
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
    clientMessageId?: string,
  ): RequestChatMessageEntity {
    return new RequestChatMessageEntity({
      requestChatId,
      author,
      content,
      createdAt: at,
      clientMessageId,
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

  get clientMessageId(): string | undefined {
    return this.props.clientMessageId;
  }
}
