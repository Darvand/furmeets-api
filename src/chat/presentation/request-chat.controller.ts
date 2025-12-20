import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ChatService } from "../application/chat.service";
import { CreateRequestChatDto } from "./dtos/create-request-chat.dto";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GetRequestChatDto } from "./dtos/get-request-chat.dto";
import { RequestChatMapper } from "../mappers/request-chat.mapper";

@Controller('request-chats')
export class RequestChatController {
    constructor(
        private readonly chatService: ChatService,
    ) { }

    @Post()
    createRequestChat(@Body() createRequestChatDto: CreateRequestChatDto) {
        return this.chatService.createRequestChat(createRequestChatDto);
    }


    @Get(':id')
    async getRequestChatById(@Param('id') id: string): Promise<GetRequestChatDto> {
        const requestChat = await this.chatService.getRequestChatByUUID(UUID.from(id));
        return RequestChatMapper.toDto(requestChat);
    }
}