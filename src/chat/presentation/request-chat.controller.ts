import { Body, Controller, Get, Headers, NotFoundException, Param, Post, Put, Req } from "@nestjs/common";
import { ChatService } from "../application/chat.service";
import { CreateRequestChatDto } from "./dtos/create-request-chat.dto";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GetRequestChatDto } from "./dtos/get-request-chat.dto";
import { RequestChatMapper } from "../mappers/request-chat.mapper";
import { ListRequestChatDto } from "./dtos/list-request-chat.dto";
import { UserService } from "src/members/application/user.service";
import type { CustomRequest } from "src/shared/types/custom-request.interface";

@Controller('request-chats')
export class RequestChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly userService: UserService,
    ) { }

    @Post()
    async createRequestChat(@Body() createRequestChatDto: CreateRequestChatDto, @Req() req: CustomRequest): Promise<GetRequestChatDto> {
        const requestChat = await this.chatService.createRequestChat(createRequestChatDto);
        return RequestChatMapper.toDto(requestChat, req.user);
    }

    @Get(':id')
    async getRequestChatById(@Param('id') id: string, @Req() req: CustomRequest): Promise<GetRequestChatDto> {
        const requestChat = await this.chatService.getRequestChatByUUID(UUID.from(id), req.user);
        const dto = RequestChatMapper.toDto(requestChat, req.user);
        return dto;
    }

    @Get()
    async getAllRequestChats(@Req() req: CustomRequest): Promise<ListRequestChatDto> {
        const requestChats = await this.chatService.getAllRequestChats();
        return RequestChatMapper.toDtoList(requestChats, req.user);
    }

    @Put("/:id/vote/:type")
    async voteOnRequestChat(
        @Param('id') id: string,
        @Param('type') type: 'approve' | 'reject',
        @Req() req: CustomRequest
    ): Promise<GetRequestChatDto> {
        const updatedRequestChat = await this.chatService.voteOnRequestChat(UUID.from(id), req.user.id, type);
        return RequestChatMapper.toDto(updatedRequestChat, req.user);
    }
}