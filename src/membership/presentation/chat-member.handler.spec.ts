import type { ConfigType } from '@nestjs/config';
import telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { MembershipService } from '../application/membership.service';
import { ChatMemberHandler } from './chat-member.handler';

const MAIN_CHAT_ID = '-1001234567890';

function setup() {
  const invalidate = jest.fn();
  const onChatMember = jest.fn();
  const handler = new ChatMemberHandler(
    { onChatMember } as unknown as TelegramBotService,
    { invalidate } as unknown as MembershipService,
    { token: 't', mainChatId: MAIN_CHAT_ID } as ConfigType<
      typeof telegramBotConfig
    >,
  );
  return { handler, invalidate, onChatMember };
}

describe('ChatMemberHandler', () => {
  it('se registra para recibir los updates chat_member al iniciar', () => {
    const { handler, onChatMember } = setup();

    handler.onModuleInit();

    expect(onChatMember).toHaveBeenCalledWith(expect.any(Function));
  });

  it('invalida el rol del usuario cuando cambia en el grupo principal', () => {
    const { handler, invalidate } = setup();

    handler.handle({
      chatId: Number(MAIN_CHAT_ID),
      userId: 42,
      status: 'kicked',
    });

    expect(invalidate).toHaveBeenCalledWith(42);
  });

  it('ignora los cambios en otros chats', () => {
    const { handler, invalidate } = setup();

    handler.handle({ chatId: -100999, userId: 42, status: 'left' });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
