import { GetUserDto } from "src/members/presentation/dtos/get-user.dto";

class RequestChatItemDto {
    uuid: string;
    requester: GetUserDto;
    lastMessage: {
        from: GetUserDto;
        content: string;
        at: string;
    };
    unreadMessagesCount: number;
    state: string;
}

export class ListRequestChatDto {
    items: RequestChatItemDto[];
}