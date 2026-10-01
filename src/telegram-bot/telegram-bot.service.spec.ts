import type { Api } from 'grammy';
import type { ChatMember, PhotoSize } from 'grammy/types';
import {
  AVATAR_MIN_SIZE_PX,
  pickAvatarSize,
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
function createService() {
  const service = new TelegramBotService({
    token: '123:TEST',
    mainChatId: '-100',
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
  return {
    service,
    getMe,
    getChatMember,
    getChat,
    getUserProfilePhotos,
    getFile,
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
    await service.getBotMemberFromGroup();

    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('cachea la membresía: dos consultas seguidas hacen una sola llamada', async () => {
    const { service, getChatMember } = createService();

    await service.isMember(1);
    await service.isMember(1);
    await service.isMember(2);

    expect(getChatMember).toHaveBeenCalledTimes(2);
  });

  it('cachea la info del grupo', async () => {
    const { service, getChat } = createService();

    await service.getGroup();
    await service.getGroup();

    expect(getChat).toHaveBeenCalledTimes(1);
  });

  it('pide una sola foto de perfil, usa el tamaño de avatar y la cachea', async () => {
    const { service, getUserProfilePhotos, getFile } = createService();

    expect(await service.getProfilePhotoPath(1)).toBe('photos/f160.jpg');
    expect(await service.getProfilePhotoPath(1)).toBe('photos/f160.jpg');

    expect(getUserProfilePhotos).toHaveBeenCalledTimes(1);
    expect(getUserProfilePhotos).toHaveBeenCalledWith(1, { limit: 1 });
    expect(getFile).toHaveBeenCalledWith('f160');
  });

  it('sin foto de perfil devuelve undefined', async () => {
    const { service, getUserProfilePhotos, getFile } = createService();
    getUserProfilePhotos.mockResolvedValue({ total_count: 0, photos: [] });

    expect(await service.getProfilePhotoPath(1)).toBeUndefined();
    expect(getFile).not.toHaveBeenCalled();
  });

  describe('isMember', () => {
    it.each([
      ['creator', {}, true],
      ['administrator', {}, true],
      ['member', {}, true],
      ['restricted', { is_member: true }, true],
      ['restricted', { is_member: false }, false],
      ['left', {}, false],
      ['kicked', {}, false],
    ])('%s %j → %s', async (status, extra, expected) => {
      const { service, getChatMember } = createService();
      getChatMember.mockResolvedValue(member(status, extra));

      expect(await service.isMember(1)).toBe(expected);
    });
  });
});
