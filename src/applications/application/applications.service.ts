import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ChatService,
  type RequestChatView,
} from 'src/chat/application/chat.service';
import { RequestChatEntity } from 'src/chat/domain/entities/request-chat.entity';
import { MediaService } from 'src/media/application/media.service';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import {
  ApplicationForm,
  type ApplicationFormProps,
  InvalidApplicationFormError,
} from '../domain/application-form';

/**
 * Envío del formulario de solicitud. El formulario decide si es válido y `media`, si sus
 * imágenes son del solicitante; la solicitud se abre con el flujo de siempre (bienvenida,
 * aviso a los miembros y anuncio en el grupo).
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly chatService: ChatService,
    private readonly mediaService: MediaService,
  ) {}

  /** Una por usuario, sin importar su estado: si ya tiene una → 409. */
  async submit(
    applicant: UserEntity,
    input: ApplicationFormProps,
  ): Promise<RequestChatView> {
    let form: ApplicationForm;
    try {
      form = ApplicationForm.submit(input);
    } catch (error) {
      if (error instanceof InvalidApplicationFormError) {
        throw new BadRequestException(error.reason);
      }
      throw error;
    }
    await this.mediaService.assertOwnUploads(
      applicant,
      form.props.imageIds ?? [],
    );
    return this.chatService.openRequestChat(
      RequestChatEntity.apply(applicant, form),
    );
  }
}
