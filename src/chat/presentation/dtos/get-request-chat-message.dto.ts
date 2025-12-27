import { GetUserDto } from "src/members/presentation/dtos/get-user.dto";

export class GetRequestChatMessageDto {
    uuid: string;
    content: string;
    user: GetUserDto;
    viewedByRequester: boolean;
    sentAt: string;
}