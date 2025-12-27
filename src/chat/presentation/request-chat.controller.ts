import { Body, Controller, Get, Headers, NotFoundException, Param, Post, Put, Query } from "@nestjs/common";
import { ChatService } from "../application/chat.service";
import { CreateRequestChatDto } from "./dtos/create-request-chat.dto";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GetRequestChatDto } from "./dtos/get-request-chat.dto";
import { RequestChatMapper } from "../mappers/request-chat.mapper";
import { ListRequestChatDto } from "./dtos/list-request-chat.dto";
import { UserService } from "src/members/application/user.service";

@Controller('request-chats')
export class RequestChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly userService: UserService,
    ) { }

    @Post()
    async createRequestChat(@Body() createRequestChatDto: CreateRequestChatDto, @Headers('x-telegram-id') telegramId: string): Promise<GetRequestChatDto> {
        const requesterEntity = await this.userService.getUserByTelegramId(Number(telegramId));
        if (!requesterEntity) {
            throw new NotFoundException(`User with Telegram ID ${telegramId} not found`);
        }
        const requestChat = await this.chatService.createRequestChat(createRequestChatDto);
        return RequestChatMapper.toDto(requestChat, requesterEntity);
    }

    @Get(':id')
    async getRequestChatById(@Param('id') id: string, @Headers('x-telegram-id') telegramId: string): Promise<GetRequestChatDto> {
        const viewerEntity = await this.userService.getUserByTelegramId(Number(telegramId));
        if (!viewerEntity) {
            throw new NotFoundException(`User with Telegram ID ${telegramId} not found`);
        }
        const requestChat = await this.chatService.getRequestChatByUUID(UUID.from(id), viewerEntity);
        console.log('Fetched request chat:', requestChat);
        const dto = RequestChatMapper.toDto(requestChat, viewerEntity);
        console.log('Mapped DTO:', dto);
        return dto;
    }

    @Get()
    async getAllRequestChats(@Headers('x-telegram-id') telegramId: string): Promise<ListRequestChatDto> {
        const viewerEntity = await this.userService.getUserByTelegramId(Number(telegramId));
        if (!viewerEntity) {
            throw new NotFoundException(`User with Telegram ID ${telegramId} not found`);
        }
        const requestChats = await this.chatService.getAllRequestChats();
        return RequestChatMapper.toDtoList(requestChats, viewerEntity);
    }

    @Put("/:id/vote/:type")
    async voteOnRequestChat(
        @Param('id') id: string,
        @Param('type') type: 'approve' | 'reject',
        @Headers('x-telegram-id') telegramId: string
    ): Promise<GetRequestChatDto> {
        const userEntity = await this.userService.getUserByTelegramId(Number(telegramId));
        if (!userEntity) {
            throw new NotFoundException(`User with Telegram ID ${telegramId} not found`);
        }
        const updatedRequestChat = await this.chatService.voteOnRequestChat(UUID.from(id), userEntity.id, type);
        return RequestChatMapper.toDto(updatedRequestChat, userEntity);
    }
}