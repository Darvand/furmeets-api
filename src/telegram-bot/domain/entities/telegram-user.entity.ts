import { Entity } from "src/shared/domain/entities/entity";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";

export interface TelegramUserProps {
    telegramId: number;
    username: string;
    avatarUrl: string;
}

export class TelegramUser extends Entity<TelegramUserProps> {
    private constructor(props: TelegramUserProps, id?: UUID) {
        super(props, id);
    }

    static create(props: TelegramUserProps, id?: UUID): TelegramUser {
        return new TelegramUser(props, id);
    }
}