import { GetUserDto } from "./get-user.dto";

export class GetGroupDto {
    uuid: string;
    telegramId: number;
    name: string
    photoUrl: string;
    description: string;
    members: GetUserDto[];
}