export class GetUserDto {
    uuid: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    telegramId: number;
    species?: string;
    birthdate?: Date;
}