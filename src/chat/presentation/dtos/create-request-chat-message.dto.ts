import { IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";

export class CreateRequestChatMessageDto {
    /**
     * Ignorado: el autor es el usuario del socket. Se acepta solo para no romper a la
     * App, que aún lo envía; se elimina cuando la App deje de enviarlo (T07).
     */
    @IsOptional()
    @IsUUID()
    userUUID?: string;

    @IsString()
    @IsNotEmpty()
    content: string;

    @IsUUID()
    requestChatUUID: string;
}
