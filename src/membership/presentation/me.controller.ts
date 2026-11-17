import { Controller, Get, Req } from '@nestjs/common';
import { ChatService } from 'src/chat/application/chat.service';
import { GroupsService } from 'src/members/application/groups.service';
import { UserMapper } from 'src/members/mappers/user.mapper';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { AdmissionService } from 'src/admission/application/admission.service';
import { RequestChatState } from 'src/chat/domain/value-objects/request-chat-state.value-object';
import { Roles } from '../domain/role';
import { MeDto } from './dtos/me.dto';

@Controller('me')
export class MeController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly chatService: ChatService,
    private readonly admissionService: AdmissionService,
  ) {}

  /**
   * Única petición de arranque de la App (RNF-REN-03). Resuelve el rol en vivo contra
   * Telegram (cacheado) y, en paralelo, busca la solicitud del usuario con una consulta
   * liviana. Fotos y grupo se refrescan en segundo plano (T39).
   */
  @Get()
  async me(@Req() req: CustomRequest): Promise<MeDto> {
    const [isMember, requestChat] = await Promise.all([
      this.groupsService.sync(req.user),
      this.chatService.findRequestChatSummaryOf(req.user),
    ]);
    const me: MeDto = {
      user: UserMapper.toDto(req.user),
      role: isMember ? Roles.Member : Roles.Applicant,
    };
    if (!isMember && requestChat) {
      me.requestChatId = requestChat.id.value;
      me.requestChatState = requestChat.state;
      // Solo los aprobados que todavía no entraron: una lectura más, poco frecuente.
      if (requestChat.state === RequestChatState.Approved().props.value) {
        me.inviteLink = await this.admissionService.inviteLinkOf(req.user.id);
      }
    }
    return me;
  }
}
