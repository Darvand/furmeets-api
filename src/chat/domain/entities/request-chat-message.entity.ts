import { UserEntity } from 'src/members/domain/entities/user.entity';
import { Entity } from 'src/shared/domain/entities/entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

/** Imágenes por mensaje: lo que Telegram admite en un álbum al republicarlo (T27). */
export const MAX_MESSAGE_IMAGES = 10;

/** Lo que escribe el autor: texto, imágenes o ambos. */
export interface MessageBody {
  content?: string;
  /** Ids de `media` subidos por el autor con `POST /media`. */
  imageIds?: readonly string[];
}

export interface RequestChatMessageProps {
  requestChatId: UUID;
  author: UserEntity;
  /** Vacío si el mensaje es solo imágenes. */
  content: string;
  imageIds?: readonly string[];
  /** Lo fija el servidor al persistir y no cambia después (deuda #5). */
  createdAt: Date;
  /**
   * Id que le puso el cliente a su envío. Un reenvío con el mismo id y autor en la misma
   * solicitud devuelve este mensaje en vez de crear otro (RNF-CON-02).
   */
  clientMessageId?: string;
}

/** El mensaje no cumple las reglas del chat (SPEC §3.2). */
export class InvalidMessageError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid message: ${reason}`);
    this.name = InvalidMessageError.name;
  }
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

  /** Mensaje nuevo de `author`: texto, imágenes o ambos (SPEC §3.2). */
  static send(
    requestChatId: UUID,
    author: UserEntity,
    body: MessageBody,
    at: Date,
    clientMessageId?: string,
  ): RequestChatMessageEntity {
    const content = body.content ?? '';
    const imageIds = body.imageIds ?? [];
    if (!/\S/.test(content) && imageIds.length === 0) {
      throw new InvalidMessageError('a message needs text or images');
    }
    if (imageIds.length > MAX_MESSAGE_IMAGES) {
      throw new InvalidMessageError(
        `at most ${MAX_MESSAGE_IMAGES} images per message`,
      );
    }
    if (new Set(imageIds).size !== imageIds.length) {
      throw new InvalidMessageError('images must not repeat');
    }
    return new RequestChatMessageEntity({
      requestChatId,
      author,
      content,
      imageIds: imageIds.length ? Object.freeze([...imageIds]) : undefined,
      createdAt: at,
      clientMessageId,
    });
  }

  /**
   * Texto para avisos de Telegram: el contenido o, si es solo imágenes, cuántas. (La
   * republicación con las imágenes en el grupo es T27.)
   */
  get preview(): string {
    if (/\S/.test(this.props.content)) {
      return this.props.content;
    }
    const count = this.imageIds.length;
    return count === 1 ? '📷 Imagen' : `📷 ${count} imágenes`;
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

  get imageIds(): readonly string[] {
    return this.props.imageIds ?? [];
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get clientMessageId(): string | undefined {
    return this.props.clientMessageId;
  }
}
