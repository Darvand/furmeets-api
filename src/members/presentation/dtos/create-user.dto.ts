export class CreateUserDto {
    username?: string;
    name: string;
    avatarUrl?: string;
    telegramId: number;
    species?: string;
    birthdate?: Date;
}