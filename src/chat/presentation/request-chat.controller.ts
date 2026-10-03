import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ChatService } from '../application/chat.service';
import { CreateRequestChatDto } from './dtos/create-request-chat.dto';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { GetRequestChatDto } from './dtos/get-request-chat.dto';
import { RequestChatMapper } from '../mappers/request-chat.mapper';
import {
  DEFAULT_LIST_LIMIT,
  ListRequestChatDto,
  ListRequestChatQueryDto,
} from './dtos/list-request-chat.dto';
import { RequestChatCursorCodec } from './request-chat-cursor';
import { VoteRequestChatParamsDto } from './dtos/vote-request-chat-params.dto';
import { UserService } from 'src/members/application/user.service';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { ApplicantsOnly, MembersOnly } from 'src/auth/presentation/roles.guard';
import { OwnerOrMember } from './owner-or-member.guard';

@Controller('request-chats')
export class RequestChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
  ) {}

  @Post()
  @ApplicantsOnly()
  async createRequestChat(
    @Body() createRequestChatDto: CreateRequestChatDto,
    @Req() req: CustomRequest,
  ): Promise<GetRequestChatDto> {
    // Hasta que T13 saque `requesterUUID` del body, solo se acepta el propio.
    if (createRequestChatDto.requesterUUID !== req.user.id.value) {
      throw new ForbiddenException('Can only create your own request chat');
    }
    const { requestChat, messages } =
      await this.chatService.createRequestChat(createRequestChatDto);
    return RequestChatMapper.toDto(requestChat, messages, req.user);
  }

  @Get(':id')
  @OwnerOrMember()
  async getRequestChatById(
    @Param('id') id: string,
    @Req() req: CustomRequest,
  ): Promise<GetRequestChatDto> {
    const { requestChat, messages } =
      await this.chatService.getRequestChatByUUID(UUID.from(id));
    return RequestChatMapper.toDto(requestChat, messages, req.user);
  }

  /** Marca como leídos todos los mensajes de la solicitud para quien la abre. */
  @Post(':id/read')
  @OwnerOrMember()
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAsRead(
    @Param('id') id: string,
    @Req() req: CustomRequest,
  ): Promise<void> {
    await this.chatService.markAsRead(UUID.from(id), req.user);
  }

  @Get()
  @MembersOnly()
  async listRequestChats(
    @Query() { limit, cursor }: ListRequestChatQueryDto,
    @Req() req: CustomRequest,
  ): Promise<ListRequestChatDto> {
    const page = await this.chatService.listRequestChats(req.user, {
      limit: limit ?? DEFAULT_LIST_LIMIT,
      after: cursor ? RequestChatCursorCodec.decode(cursor) : undefined,
    });
    return RequestChatMapper.toDtoList(page);
  }

  @Put('/:id/vote/:type')
  @MembersOnly()
  async voteOnRequestChat(
    @Param() { id, type }: VoteRequestChatParamsDto,
    @Req() req: CustomRequest,
  ): Promise<GetRequestChatDto> {
    const { requestChat, messages } = await this.chatService.voteOnRequestChat(
      UUID.from(id),
      req.user,
      type,
    );
    return RequestChatMapper.toDto(requestChat, messages, req.user);
  }
}
