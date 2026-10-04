import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { ChatModule } from 'src/chat/chat.module';
import { MediaModule } from 'src/media/media.module';
import { MembershipModule } from 'src/membership/membership.module';
import { ApplicationsService } from './application/applications.service';
import { ApplicationsController } from './presentation/applications.controller';

/**
 * Formulario de solicitud (SPEC §3.1). La solicitud se guarda con su chat en `chat`
 * hasta que ese módulo se separe en `applications`, `request-chat` y `review`.
 */
@Module({
  imports: [AuthModule, MembershipModule, ChatModule, MediaModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
