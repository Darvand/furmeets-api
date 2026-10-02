export class GetUserDto {
    uuid: string;
    name: string;
    username?: string;
    /** Se pide a `GET /media/:id`. */
    avatarMediaId?: string;
    telegramId: number;
    species?: string;
    birthdate?: Date;
}