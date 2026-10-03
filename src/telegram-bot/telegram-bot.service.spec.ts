import type { Api } from 'grammy';
import type { ChatMember, PhotoSize } from 'grammy/types';
import {
  AVATAR_MIN_SIZE_PX,
  pickAvatarSize,
  StorageNotConfiguredError,
  TelegramBotService,
} from './telegram-bot.service';

const size = (side: number): PhotoSize => ({
  file_id: `f${side}`,
  file_unique_id: `u${side}`,
  width: side,
  height: side,
});

const ME = {
  id: 999,
  is_bot: true as const,
  first_name: 'FurBot',
  username: 'furbot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

const member = (status: string, extra: object = {}) =>
  ({
    status,
    user: { id: 1, is_bot: false, first_name: 'Ana' },
    ...extra,
  }) as unknown as ChatMember;

/** Servicio real con la API de grammY reemplazada por dobles (sin red). */
function createService({ withStorage = true } = {}) {
  const service = new TelegramBotService({
    token: '123:TEST',
    mainChatId: '-100',
    storageChatId: withStorage ? '-200' : undefined,
  });
  const api = (service as unknown as { bot: { api: Api } }).bot.api;
  const getMe = jest.spyOn(api, 'getMe').mockResolvedValue(ME);
  const getChatMember = jest
    .spyOn(api, 'getChatMember')
    .mockResolvedValue(member('member'));
  const getChat = jest
    .spyOn(api, 'getChat')
    .mockResolvedValue({ id: -100, type: 'supergroup' } as never);
  const getUserProfilePhotos = jest
    .spyOn(api, 'getUserProfilePhotos')
    .mockResolvedValue({ total_count: 1, photos: [[size(160), size(640)]] });
  const getFile = jest.spyOn(api, 'getFile').mockImplementation((fileId) =>
    Promise.resolve({
      file_id: fileId,
      file_unique_id: 'u',
      file_path: `photos/${fileId}.jpg`,
    }),
  );
  const sendPhoto = jest
    .spyOn(api, 'sendPhoto')
    .mockResolvedValue({ photo: [size(320), size(1280)] } as never);
  return {
    service,
    getMe,
    getChatMember,
    getChat,
    getUserProfilePhotos,
    getFile,
    sendPhoto,
  };
}

describe('pickAvatarSize', () => {
  it('elige el tamaño más pequeño que alcanza el mínimo, no el de 640 px', () => {
    expect(pickAvatarSize([size(640), size(160), size(320)])?.width).toBe(160);
  });

  it('salta los tamaños menores al mínimo', () => {
    expect(pickAvatarSize([size(80), size(320), size(640)])?.width).toBe(320);
  });

  it('tolera fotos con un solo tamaño, aunque sea menor al mínimo', () => {
    expect(pickAvatarSize([size(100)])?.width).toBe(100);
    expect(AVATAR_MIN_SIZE_PX).toBeGreaterThan(100);
  });

  it('devuelve undefined si no hay tamaños', () => {
    expect(pickAvatarSize([])).toBeUndefined();
  });
});

describe('TelegramBotService', () => {
  it('llama a getMe una sola vez, aunque se pida la info del bot en paralelo', async () => {
    const { service, getMe } = createService();

    await Promise.all([service.getBotInfo(), service.getBotInfo()]);
    await service.getBotInfo();

    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('no cachea la membresía (la cachea MembershipService, que sabe invalidarla)', async () => {
    const { service, getChatMember } = createService();

    await service.getMemberFromGroup(1);
    await service.getMemberFromGroup(1);

    expect(getChatMember).toHaveBeenCalledTimes(2);
  });

  it('entrega los updates chat_member al handler registrado', async () => {
    const { service } = createService();
    const handler = jest.fn();
    service.onChatMember(handler);
    await service.getBotInfo();

    const bot = (
      service as unknown as {
        bot: { handleUpdate: (u: unknown) => Promise<void> };
      }
    ).bot;
    await bot.handleUpdate({
      update_id: 1,
      chat_member: {
        chat: { id: -100, type: 'supergroup', title: 'FurMeets' },
        from: { id: 7, is_bot: false, first_name: 'Admin' },
        date: 1_700_000_000,
        old_chat_member: member('member'),
        new_chat_member: member('kicked', { until_date: 0 }),
      },
    });

    expect(handler).toHaveBeenCalledWith({
      chatId: -100,
      userId: 1,
      status: 'kicked',
    });
  });

  it('cachea la info del grupo', async () => {
    const { service, getChat } = createService();

    await service.getGroup();
    await service.getGroup();

    expect(getChat).toHaveBeenCalledTimes(1);
  });

  it('pide una sola foto de perfil, usa el tamaño de avatar y la cachea', async () => {
    const { service, getUserProfilePhotos, getFile } = createService();

    expect(await service.getProfilePhoto(1)).toEqual(size(160));
    expect(await service.getProfilePhoto(1)).toEqual(size(160));

    expect(getUserProfilePhotos).toHaveBeenCalledTimes(1);
    expect(getUserProfilePhotos).toHaveBeenCalledWith(1, { limit: 1 });
    // El `file_path` caduca: no se pide aquí, sino al servir la imagen (`media`).
    expect(getFile).not.toHaveBeenCalled();
  });

  it('sin foto de perfil devuelve undefined', async () => {
    const { service, getUserProfilePhotos } = createService();
    getUserProfilePhotos.mockResolvedValue({ total_count: 0, photos: [] });

    expect(await service.getProfilePhoto(1)).toBeUndefined();
  });

  it('sube al canal de almacenamiento en silencio y devuelve el tamaño más grande', async () => {
    const { service, sendPhoto } = createService();

    expect(await service.uploadPhotoToStorage(Buffer.from('jpg'))).toEqual(
      size(1280),
    );
    expect(sendPhoto).toHaveBeenCalledWith('-200', expect.anything(), {
      disable_notification: true,
    });
  });

  it('sin canal de almacenamiento no sube nada', async () => {
    const { service, sendPhoto } = createService({ withStorage: false });

    await expect(
      service.uploadPhotoToStorage(Buffer.from('jpg')),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it('un error de descarga no expone la URL con el token', async () => {
    const { service } = createService();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(
        new Error('fetch failed: https://api.telegram.org/file/bot123:TEST/x'),
      );

    const error = await service
      .downloadFile('photos/x.jpg')
      .catch((e: unknown) => e);

    expect(String(error)).not.toContain('123:TEST');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.telegram.org/file/bot123:TEST/photos/x.jpg',
    );
    fetchSpy.mockRestore();
  });
});
