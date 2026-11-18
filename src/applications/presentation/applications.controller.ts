import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApplicantsOnly } from 'src/auth/presentation/roles.guard';
import { RequestChatMapper } from 'src/chat/mappers/request-chat.mapper';
import { GetRequestChatDto } from 'src/chat/presentation/dtos/get-request-chat.dto';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { ApplicationsService } from '../application/applications.service';
import { CreateApplicationDto } from './dtos/create-application.dto';

/** El formulario no se edita una vez enviado: no hay endpoint de edición (SPEC §3.1). */
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  /** Envía el formulario y abre el chat de la solicitud, que devuelve sin votos. */
  @Post()
  @ApplicantsOnly()
  async submit(
    @Body() dto: CreateApplicationDto,
    @Req() req: CustomRequest,
  ): Promise<GetRequestChatDto> {
    const view = await this.applicationsService.submit(
      req.user,
      // `requesterUUID` no se usa: el formulario solo toma sus campos.
      dto,
    );
    return RequestChatMapper.toRequesterDto(view);
  }
}
