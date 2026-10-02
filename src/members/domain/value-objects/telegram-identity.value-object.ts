import { ValueObject } from 'src/shared/domain/value-objects/value-object';

interface TelegramIdentityProps {
  telegramId: number;
  name: string;
  username?: string;
  photoUrl?: string;
}

/**
 * Cómo Telegram describe al usuario en un `initData` ya validado. No tiene identidad
 * propia: es la fuente de verdad del nombre y el usuario de Telegram de `UserEntity`.
 */
export class TelegramIdentity extends ValueObject<TelegramIdentityProps> {
  private constructor(props: TelegramIdentityProps) {
    super(props);
  }

  static create(props: {
    telegramId: number;
    firstName: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
  }): TelegramIdentity {
    if (!Number.isSafeInteger(props.telegramId)) {
      throw new Error(`Invalid Telegram ID: ${props.telegramId}`);
    }
    return new TelegramIdentity({
      telegramId: props.telegramId,
      name: [props.firstName, props.lastName].filter(Boolean).join(' '),
      username: props.username || undefined,
      photoUrl: props.photoUrl || undefined,
    });
  }

  get telegramId(): number {
    return this.props.telegramId;
  }

  get name(): string {
    return this.props.name;
  }

  get username(): string | undefined {
    return this.props.username;
  }

  get photoUrl(): string | undefined {
    return this.props.photoUrl;
  }
}
