import { BadGatewayException } from '@nestjs/common';
import type { Readable } from 'stream';
import type { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import { TelegramStorageAdapter } from './telegram-storage.adapter';

const read = async (body: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString();
};

function setup() {
  let pathVersion = 0;
  const telegram = {
    getFilePath: jest.fn(() => Promise.resolve(`photos/v${++pathVersion}.jpg`)),
    downloadFile: jest.fn((path: string) =>
      Promise.resolve(
        new Response(`bytes de ${path}`, {
          headers: { 'content-length': '20' },
        }),
      ),
    ),
    uploadPhotoToStorage: jest.fn(),
  };
  const adapter = new TelegramStorageAdapter(
    telegram as unknown as TelegramBotService,
  );
  return { adapter, telegram };
}

describe('TelegramStorageAdapter.open', () => {
  it('cachea el file_path: dos aperturas, un solo getFile', async () => {
    const { adapter, telegram } = setup();

    const first = await adapter.open('file-1');
    await adapter.open('file-1');

    expect(await read(first.body)).toBe('bytes de photos/v1.jpg');
    expect(first.length).toBe(20);
    expect(telegram.getFilePath).toHaveBeenCalledTimes(1);
    expect(telegram.downloadFile).toHaveBeenCalledTimes(2);
  });

  it('si el file_path cacheado venció, pide uno nuevo una vez', async () => {
    const { adapter, telegram } = setup();
    telegram.downloadFile.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    const media = await adapter.open('file-1');

    expect(await read(media.body)).toBe('bytes de photos/v2.jpg');
    expect(telegram.getFilePath).toHaveBeenCalledTimes(2);
  });

  it('si Telegram sigue fallando responde 502', async () => {
    const { adapter, telegram } = setup();
    telegram.downloadFile.mockImplementation(() =>
      Promise.resolve(new Response('Not Found', { status: 404 })),
    );

    await expect(adapter.open('file-1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(telegram.downloadFile).toHaveBeenCalledTimes(2);
  });
});
