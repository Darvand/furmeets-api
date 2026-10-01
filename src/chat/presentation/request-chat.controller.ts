import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Req } from "@nestjs/common";
import { ChatService } from "../application/chat.service";
import { CreateRequestChatDto } from "./dtos/create-request-chat.dto";
import { UUID } from "src/shared/domain/value-objects/uuid.value-object";
import { GetRequestChatDto } from "./dtos/get-request-chat.dto";
import { RequestChatMapper } from "../mappers/request-chat.mapper";
import { ListRequestChatDto } from "./dtos/list-request-chat.dto";
import { VoteRequestChatParamsDto } from "./dtos/vote-request-chat-params.dto";
import { UserService } from "src/members/application/user.service";
import type { CustomRequest } from "src/shared/types/custom-request.interface";
import { ApplicantsOnly, MembersOnly } from "src/auth/presentation/roles.guard";
import { OwnerOrMember } from "./owner-or-member.guard";

@Controller('request-chats')
export class RequestChatController {
    constructor(
        private readonly chatService: ChatService,
        private readonly userService: UserService,
    ) { }

    @Post()
    @ApplicantsOnly()
    async createRequestChat(@Body() createRequestChatDto: CreateRequestChatDto, @Req() req: CustomRequest): Promise<GetRequestChatDto> {
        // Hasta que T13 saque `requesterUUID` del body, solo se acepta el propio.
        if (createRequestChatDto.requesterUUID !== req.user.id.value) {
            throw new ForbiddenException('Can only create your own request chat');
        }
        const requestChat = await this.chatService.createRequestChat(createRequestChatDto);
        return RequestChatMapper.toDto(requestChat, req.user);
    }

    @Get(':id')
    @OwnerOrMember()
    async getRequestChatById(@Param('id') id: string, @Req() req: CustomRequest): Promise<GetRequestChatDto> {
        const requestChat = await this.chatService.getRequestChatByUUID(UUID.from(id), req.user);
        const dto = RequestChatMapper.toDto(requestChat, req.user);
        return dto;
    }

    @Get()
    @MembersOnly()
    async getAllRequestChats(@Req() req: CustomRequest): Promise<ListRequestChatDto> {
        const requestChats = await this.chatService.getAllRequestChats();
        return RequestChatMapper.toDtoList(requestChats, req.user);
    }

    @Put("/:id/vote/:type")
    @MembersOnly()
    async voteOnRequestChat(
        @Param() { id, type }: VoteRequestChatParamsDto,
        @Req() req: CustomRequest
    ): Promise<GetRequestChatDto> {
        const updatedRequestChat = await this.chatService.voteOnRequestChat(UUID.from(id), req.user, type);
        return RequestChatMapper.toDto(updatedRequestChat, req.user);
    }
}