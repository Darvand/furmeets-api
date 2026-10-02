import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import { RequestChatMessageEntity } from './request-chat-message.entity';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatMessageEntity', () => {
  const author = user(1);
  const reader = user(2);
  const at = new Date('2026-10-02T15:00:00.000Z');

  it('un mensaje enviado ya está leído por su autor', () => {
    const message = RequestChatMessageEntity.send(
      UUID.generate(),
      author,
      'hola',
      at,
    );

    expect(message.createdAt).toBe(at);
    expect(message.isReadBy(author)).toBe(true);
    expect(message.isReadBy(reader)).toBe(false);
  });

  it('markReadBy registra quién lo leyó y cuándo, solo una vez', () => {
    const message = RequestChatMessageEntity.send(
      UUID.generate(),
      author,
      'hola',
      at,
    );
    const readAt = new Date('2026-10-02T16:00:00.000Z');

    expect(message.markReadBy(reader, readAt)).toBe(true);
    expect(message.markReadBy(reader, new Date())).toBe(false);
    expect(message.props.readBy).toEqual([
      { userId: author.id.value, at },
      { userId: reader.id.value, at: readAt },
    ]);
  });
});
