import { IsNotEmpty, IsString, IsUUID } from "class-validator";

export class CreateRequestChatMessageDto {
    @IsUUID()
    userUUID: string;

    @IsString()
    @IsNotEmpty()
    content: string;

    @IsUUID()
    requestChatUUID: string;
}
