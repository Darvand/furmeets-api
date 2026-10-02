import { GetUserDto } from "./get-user.dto";

export class GetGroupDto {
    uuid: string;
    telegramId: number;
    name: string
    /** Se pide a `GET /media/:id`. */
    photoMediaId?: string;
    description: string;
    members: GetUserDto[];
}