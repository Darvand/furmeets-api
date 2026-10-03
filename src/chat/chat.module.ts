import { Module } from '@nestjs/common';
import { ChatGateway } from './presentation/chat.gateway';
import { CHAT_PROVIDERS } from './chat.providers';
import { ChatMongoRepository } from './infraestructure/repositories/chat-mongo.repository';
import { MembersModule } from 'src/members/members.module';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RequestChat,
  RequestChatSchema,
} from './infraestructure/schemas/request-chat.schema';
import { DatabaseModule } from 'src/database/database.module';
import { ChatService } from './application/chat.service';
import { RequestChatController } from './presentation/request-chat.controller';
import { TelegramBotModule } from 'src/telegram-bot/telegram-bot.module';
import { AuthModule } from 'src/auth/auth.module';
import { MembershipModule } from 'src/membership/membership.module';
import { RequestChatAccessService } from './application/request-chat-access.service';
import { RequestChatMessageMongoRepository } from './infraestructure/repositories/request-chat-message-mongo.repository';
import {
  RequestChatMessage,
  RequestChatMessageSchema,
} from './infraestructure/schemas/request-chat-message.schema';
import {
  RequestChatRead,
  RequestChatReadSchema,
} from './infraestructure/schemas/request-chat-read.schema';

@Module({
  providers: [
    ChatService,
    ChatGateway,
    RequestChatAccessService,
    {
      provide: CHAT_PROVIDERS.RequestChatRepository,
      useClass: ChatMongoRepository,
    },
    {
      provide: CHAT_PROVIDERS.RequestChatMessageRepository,
      useClass: RequestChatMessageMongoRepository,
    },
  ],
  controllers: [RequestChatController],
  exports: [ChatService],
  imports: [
    DatabaseModule,
    MembersModule,
    AuthModule,
    MembershipModule,
    TelegramBotModule,
    MongooseModule.forFeature([
      { name: RequestChat.name, schema: RequestChatSchema },
      { name: RequestChatMessage.name, schema: RequestChatMessageSchema },
      { name: RequestChatRead.name, schema: RequestChatReadSchema },
    ]),
  ],
})
export class ChatModule {}
