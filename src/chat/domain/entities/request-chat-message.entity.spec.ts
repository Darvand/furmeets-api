import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  InvalidMessageError,
  MAX_MESSAGE_IMAGES,
  REPLY_EXCERPT_LENGTH,
  RequestChatMessageEntity,
} from './request-chat-message.entity';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

describe('RequestChatMessageEntity', () => {
  const author = user(1);
  const at = new Date('2026-10-02T15:00:00.000Z');
  const chatId = UUID.generate();

  it('un mensaje enviado es de su autor y conserva la fecha que le da el servidor', () => {
    const message = RequestChatMessageEntity.send(
      chatId,
      author,
      { content: 'hola' },
      at,
    );

    expect(message.createdAt).toBe(at);
    expect(message.fromUser(author)).toBe(true);
    expect(message.fromUser(user(2))).toBe(false);
  });

  it('puede llevar solo imágenes, sin texto', () => {
    const message = RequestChatMessageEntity.send(
      chatId,
      author,
      { imageIds: ['img-1', 'img-2'] },
      at,
    );

    expect(message.content).toBe('');
    expect(message.imageIds).toEqual(['img-1', 'img-2']);
  });

  it.each([
    ['sin texto ni imágenes', {}],
    ['con texto en blanco y sin imágenes', { content: '  \n' }],
    [
      `con más de ${MAX_MESSAGE_IMAGES} imágenes`,
      {
        imageIds: Array.from(
          { length: MAX_MESSAGE_IMAGES + 1 },
          (_, i) => `img-${i}`,
        ),
      },
    ],
    ['con una imagen repetida', { imageIds: ['img-1', 'img-1'] }],
  ])('se rechaza un mensaje %s', (_, body) => {
    expect(() =>
      RequestChatMessageEntity.send(chatId, author, body, at),
    ).toThrow(InvalidMessageError);
  });

  it.each([
    [{ content: 'hola', imageIds: ['a'] }, 'hola'],
    [{ imageIds: ['a'] }, '📷 Imagen'],
    [{ imageIds: ['a', 'b'] }, '📷 2 imágenes'],
  ])('el resumen para avisos de %j es %s', (body, preview) => {
    expect(
      RequestChatMessageEntity.send(chatId, author, body, at).preview,
    ).toBe(preview);
  });

  describe('respuestas', () => {
    it('cita al autor y un extracto del mensaje respondido', () => {
      const original = RequestChatMessageEntity.send(
        chatId,
        user(2),
        { content: 'x'.repeat(REPLY_EXCERPT_LENGTH + 20) },
        at,
      );

      const reply = RequestChatMessageEntity.send(
        chatId,
        author,
        { content: 'de acuerdo', replyTo: original.quote() },
        at,
      );

      // Por `.value`: `ValueObject.equals` no compara hasta T45.
      expect(reply.replyTo?.messageId.value).toBe(original.id.value);
      expect(reply.replyTo?.author).toBe(original.author);
      expect(reply.replyTo?.excerpt).toBe(
        `${'x'.repeat(REPLY_EXCERPT_LENGTH)}…`,
      );
      expect(reply.replyTo?.hasImages).toBe(false);
    });

    it('la cita de un mensaje con solo imágenes no tiene texto pero lo indica', () => {
      const photo = RequestChatMessageEntity.send(
        chatId,
        user(2),
        { imageIds: ['img-1'] },
        at,
      );

      expect(photo.quote()).toMatchObject({ excerpt: '', hasImages: true });
    });
  });
});
