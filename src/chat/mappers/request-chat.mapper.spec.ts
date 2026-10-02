import { UserEntity } from 'src/members/domain/entities/user.entity';
import { RequestChatMessageEntity } from '../domain/entities/request-chat-message.entity';
import { RequestChatEntity } from '../domain/entities/request-chat.entity';
import { RequestChatMapper } from './request-chat.mapper';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatMapper', () => {
  const requester = user(1);
  const member = user(2);
  const bot = user(999);
  const requestChat = RequestChatEntity.asNew(requester, 'furros');
  const welcome = requestChat.welcomeMessage(
    bot,
    new Date('2026-10-02T15:00:00.000Z'),
  );
  const hello = RequestChatMessageEntity.send(
    requestChat.id,
    requester,
    'hola',
    new Date('2026-10-02T15:05:30.123Z'),
  );

  it('las fechas de los mensajes van en ISO-8601 UTC, sin formato del servidor', () => {
    const dto = RequestChatMapper.toDto(
      requestChat,
      [welcome, hello],
      requester,
    );

    expect(dto.messages.map((m) => m.sentAt)).toEqual([
      '2026-10-02T15:00:00.000Z',
      '2026-10-02T15:05:30.123Z',
    ]);
    expect(dto.messages.map((m) => m.viewedByRequester)).toEqual([false, true]);
  });

  it('el listado da el último mensaje en ISO UTC y los no leídos de quien mira', () => {
    const list = RequestChatMapper.toDtoList(
      [requestChat],
      new Map([[requestChat.id.value, [welcome, hello]]]),
      member,
    );

    expect(list.items[0].lastMessage).toMatchObject({
      content: 'hola',
      at: '2026-10-02T15:05:30.123Z',
    });
    expect(list.items[0].unreadMessagesCount).toBe(2);
  });

  it('una solicitud sin mensajes (sin migrar) sale sin último mensaje', () => {
    const list = RequestChatMapper.toDtoList([requestChat], new Map(), member);

    expect(list.items[0].lastMessage).toBeUndefined();
    expect(list.items[0].unreadMessagesCount).toBe(0);
  });
});
