import { GetUserDto } from "src/members/presentation/dtos/get-user.dto";
import { GetRequestChatMessageDto } from "./get-request-chat-message.dto";

export class GetRequestChatDto {
    uuid: string;
    requester: GetUserDto;
    messages: GetRequestChatMessageDto[];
    votes: {
        approved: number;
        rejected: number;
    };
    state: string;
    userVote?: string;
    whereYouFoundUs?: string;
    interests?: string;
}