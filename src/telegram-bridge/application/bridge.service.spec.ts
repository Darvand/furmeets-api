import type { MediaService } from 'src/media/application/media.service';
import type { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { BridgeService } from './bridge.service';

const CHAT_ID = '3f2b8a4e-0000-4000-8000-000000000001';

function setup(fileIds: string[] = []) {
  const telegram = {
    sendTextToGroup: jest.fn((text: string) => Promise.resolve(text.length)),
    sendPhotosToGroup: jest.fn((ids: string[]) =>
      Promise.resolve(ids.map((_, i) => 100 + i)),
    ),
  };
  const media = { fileIdsOf: jest.fn(() => Promise.resolve(fileIds)) };
  const service = new BridgeService(
    telegram as unknown as TelegramBotService,
    media as unknown as MediaService,
  );
  return { service, telegram, media };
}

const message = (content: string, imageIds: string[] = []) => ({
  requestChatId: CHAT_ID,
  requesterName: 'Ana',
  content,
  imageIds,
});

describe('BridgeService', () => {
  it('republica un texto con el encabezado y el enlace a la solicitud', async () => {
    const { service, telegram } = setup();

    const ids = await service.republish(message('hola'));

    expect(ids).toEqual(['Ana · solicitud\nhola'.length]);
    expect(telegram.sendTextToGroup).toHaveBeenCalledWith(
      'Ana · solicitud\nhola',
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text_link',
          url: expect.stringContaining(`startapp=${CHAT_ID}`) as string,
        }),
      ]),
    );
    expect(telegram.sendPhotosToGroup).not.toHaveBeenCalled();
  });

  it('republica las imágenes con su file_id, con el texto de pie', async () => {
    const { service, telegram, media } = setup(['f1', 'f2']);

    const ids = await service.republish(message('mira', ['m1', 'm2']));

    expect(media.fileIdsOf).toHaveBeenCalledWith(['m1', 'm2']);
    expect(telegram.sendPhotosToGroup).toHaveBeenCalledWith(
      ['f1', 'f2'],
      'Ana · solicitud\nmira',
      expect.any(Array),
    );
    expect(telegram.sendTextToGroup).not.toHaveBeenCalled();
    expect(ids).toEqual([100, 101]);
  });

  it('si el texto no cabe en el pie, lo manda aparte y devuelve todos los ids', async () => {
    const { service, telegram } = setup(['f1']);
    const long = 'a'.repeat(1_500);

    const ids = await service.republish(message(long, ['m1']));

    expect(telegram.sendPhotosToGroup).toHaveBeenCalledWith(
      ['f1'],
      'Ana · solicitud',
      expect.any(Array),
    );
    expect(telegram.sendTextToGroup).toHaveBeenCalledWith(long, []);
    expect(ids).toEqual([100, 1_500]);
  });

  it('si Telegram falla, el error sube a quien lo llamó', async () => {
    const { service, telegram } = setup();
    telegram.sendTextToGroup.mockRejectedValue(new Error('caído'));

    await expect(service.republish(message('hola'))).rejects.toThrow('caído');
  });
});
