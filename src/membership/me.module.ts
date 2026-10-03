import { Module } from '@nestjs/common';
import { ChatModule } from 'src/chat/chat.module';
import { MembersModule } from 'src/members/members.module';
import { MeController } from './presentation/me.controller';

/**
 * `GET /me`. Va aparte de `MembershipModule` porque necesita a `members` y `chat`, que a
 * su vez dependen de `MembershipModule`: juntos formarían un ciclo.
 */
@Module({
  imports: [MembersModule, ChatModule],
  controllers: [MeController],
})
export class MeModule {}
