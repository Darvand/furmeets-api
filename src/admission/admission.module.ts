import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MembersModule } from 'src/members/members.module';
import { MembershipModule } from 'src/membership/membership.module';
import { TelegramBotModule } from 'src/telegram-bot/telegram-bot.module';
import {
  RequestChat,
  RequestChatSchema,
} from 'src/chat/infraestructure/schemas/request-chat.schema';
import { AdmissionService } from './application/admission.service';
import { ADMISSION_REPOSITORY } from './domain/admission.repository';
import { AdmissionMongoRepository } from './infraestructure/admission-mongo.repository';
import { ChatJoinRequestHandler } from './presentation/chat-join-request.handler';

/**
 * Admisión al grupo (SPEC §3.4). No importa `ChatModule`, que la usa al aprobar una
 * solicitud: lee y escribe sus propios campos en la colección de solicitudes. Mongoose
 * reutiliza el mismo modelo porque el schema es el mismo objeto.
 */
@Module({
  imports: [
    TelegramBotModule,
    MembershipModule,
    MembersModule,
    MongooseModule.forFeature([
      { name: RequestChat.name, schema: RequestChatSchema },
    ]),
  ],
  providers: [
    AdmissionService,
    ChatJoinRequestHandler,
    { provide: ADMISSION_REPOSITORY, useClass: AdmissionMongoRepository },
  ],
  exports: [AdmissionService],
})
export class AdmissionModule {}
