import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ChatService } from '../application/chat.service';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  GetRequestChatDto,
  MemberRequestChatDto,
} from './dtos/get-request-chat.dto';
import { RequestChatMapper } from '../mappers/request-chat.mapper';
import {
  DEFAULT_LIST_LIMIT,
  ListRequestChatDto,
  ListRequestChatQueryDto,
} from './dtos/list-request-chat.dto';
import { RequestChatCursorCodec } from './request-chat-cursor';
import {
  DEFAULT_MESSAGES_LIMIT,
  ListMessagesDto,
  ListMessagesQueryDto,
} from './dtos/list-request-chat-messages.dto';
import { RequestChatMessageMapper } from '../mappers/request-chat-message.mapper';
import { VoteRequestChatParamsDto } from './dtos/vote-request-chat-params.dto';
import { VoteRequestChatDto } from './dtos/vote-request-chat.dto';
import { UserService } from 'src/members/application/user.service';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { MembersOnly } from 'src/auth/presentation/roles.guard';
import { OwnerOrMember } from './owner-or-member.guard';
import { RequestChatAccessService } from '../application/request-chat-access.service';
import { EndorsementService } from '../application/endorsement.service';
import { RequestChatEndorsementsDto } from './dtos/endorsement.dto';

@Controller('request-chats')
export class RequestChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly access: RequestChatAccessService,
    private readonly endorsements: EndorsementService,
  ) {}

  /**
   * Una página de mensajes: los anteriores a `before`, para subir por el historial (T18,
   * RNF-REN-04), o los posteriores a `after`, para recuperar lo perdido tras una
   * desconexión (RNF-CON-03). `hasMore` dice si quedan en esa dirección.
   */
  @Get(':id/messages')
  @OwnerOrMember()
  async getMessages(
    @Param('id') id: string,
    @Query() { before, after, limit }: ListMessagesQueryDto,
  ): Promise<ListMessagesDto> {
    if ((before === undefined) === (after === undefined)) {
      throw new BadRequestException('Use either before or after');
    }
    const page = await this.chatService.getMessages(
      UUID.from(id),
      before ? { before: UUID.from(before) } : { after: UUID.from(after) },
      limit ?? DEFAULT_MESSAGES_LIMIT,
    );
    return {
      items: page.items.map((message) =>
        RequestChatMessageMapper.toDto(message),
      ),
      hasMore: page.hasMore,
    };
  }

  /**
   * Un miembro recibe la solicitud con la votación; su solicitante, mientras no sea
   * miembro, sin ella (RNF-PRI-03).
   */
  @Get(':id')
  @OwnerOrMember()
  async getRequestChatById(
    @Param('id') id: string,
    @Req() req: CustomRequest,
  ): Promise<GetRequestChatDto | MemberRequestChatDto> {
    const [view, isMember] = await Promise.all([
      this.chatService.getRequestChatByUUID(UUID.from(id)),
      // El guard ya resolvió el rol: aquí sale de la caché.
      this.access.isMember(req.user),
    ]);
    return isMember
      ? RequestChatMapper.toMemberDto(view, req.user)
      : RequestChatMapper.toRequesterDto(view);
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

  /** "Lo conozco, lo avalo". Avalar dos veces no duplica. */
  @Put('/:id/endorsement')
  @MembersOnly()
  async endorse(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: CustomRequest,
  ): Promise<RequestChatEndorsementsDto> {
    return RequestChatMapper.toEndorsementsDto(
      await this.endorsements.endorse(UUID.from(id), req.user),
    );
  }

  /** Retira el aval propio; sin aval previo no cambia nada. */
  @Delete('/:id/endorsement')
  @MembersOnly()
  async withdrawEndorsement(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: CustomRequest,
  ): Promise<RequestChatEndorsementsDto> {
    return RequestChatMapper.toEndorsementsDto(
      await this.endorsements.withdraw(UUID.from(id), req.user),
    );
  }
}
