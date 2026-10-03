import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageEntity } from './request-chat-message.entity';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatMessageEntity', () => {
  const author = user(1);
  const at = new Date('2026-10-02T15:00:00.000Z');

  it('un mensaje enviado es de su autor y conserva la fecha que le da el servidor', () => {
    const message = RequestChatMessageEntity.send(
      UUID.generate(),
      author,
      'hola',
      at,
    );

    expect(message.createdAt).toBe(at);
    expect(message.fromUser(author)).toBe(true);
    expect(message.fromUser(user(2))).toBe(false);
  });
});
