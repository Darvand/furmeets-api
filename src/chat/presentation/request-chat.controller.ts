import { Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { ChatService } from '../application/chat.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { GetRequestChatDto } from './dtos/get-request-chat.dto';
import { RequestChatMapper } from '../mappers/request-chat.mapper';
import {
  DEFAULT_LIST_LIMIT,
  ListRequestChatDto,
  ListRequestChatQueryDto,
} from './dtos/list-request-chat.dto';
import { RequestChatCursorCodec } from './request-chat-cursor';
import {
  DEFAULT_MESSAGES_LIMIT,
  ListMessagesAfterDto,
  ListMessagesAfterQueryDto,
} from './dtos/list-request-chat-messages.dto';
import { RequestChatMessageMapper } from '../mappers/request-chat-message.mapper';
import { VoteRequestChatParamsDto } from './dtos/vote-request-chat-params.dto';
import { VoteRequestChatDto } from './dtos/vote-request-chat.dto';
import { UserService } from 'src/members/application/user.service';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { MembersOnly } from 'src/auth/presentation/roles.guard';
import { OwnerOrMember } from './owner-or-member.guard';

@Controller('request-chats')
export class RequestChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
  ) {}

  /**
   * Mensajes posteriores a `after`, para recuperar lo perdido tras una desconexión
   * (RNF-CON-03). Paginado hacia adelante con `hasMore`.
   */
  @Get(':id/messages')
  @OwnerOrMember()
  async getMessagesAfter(
    @Param('id') id: string,
    @Query() { after, limit }: ListMessagesAfterQueryDto,
  ): Promise<ListMessagesAfterDto> {
    const page = await this.chatService.getMessagesAfter(
      UUID.from(id),
      UUID.from(after),
      limit ?? DEFAULT_MESSAGES_LIMIT,
    );
    return {
      items: page.items.map((message) =>
        RequestChatMessageMapper.toDto(message),
      ),
      hasMore: page.hasMore,
    };
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
  ): Promise<VoteRequestChatDto> {
    const result = await this.chatService.voteOnRequestChat(
      UUID.from(id),
      req.user,
      type,
    );
    return RequestChatMapper.toVoteDto(result);
  }
}
