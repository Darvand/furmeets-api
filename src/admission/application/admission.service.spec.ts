import type { ConfigType } from '@nestjs/config';
import type telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import type { TelegramBotService } from 'src/telegram-bot/telegram-bot.service';
import type { MembershipService } from 'src/membership/application/membership.service';
import type { UserService } from 'src/members/application/user.service';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import type { Admission } from '../domain/admission';
import type { AdmissionRepository } from '../domain/admission.repository';
import { AdmissionService } from './admission.service';

const MAIN_CHAT_ID = '-1001234567890';
const LINK = 'https://t.me/+AbCdEf_123';
const requestChatId = UUID.from('0b6f3c1e-8a2d-4f5b-9c7e-1d2e3f4a5b6c');
const applicant = UserEntity.create({
  name: 'Ana',
  telegramId: 42,
  isMember: false,
});

function setup(stored: Admission | null) {
  const admissions = {
    findById: jest.fn(() => Promise.resolve(stored)),
    findByRequester: jest.fn(() => Promise.resolve(stored)),
    saveInviteLink: jest.fn(() => Promise.resolve(true)),
    markAdmitted: jest.fn(() => Promise.resolve(true)),
  };
  const telegram = {
    createAdmissionLink: jest.fn<Promise<string>, [string, Date]>(() =>
      Promise.resolve(LINK),
    ),
    revokeInviteLink: jest.fn(() => Promise.resolve()),
    approveJoinRequest: jest.fn(() => Promise.resolve()),
    declineJoinRequest: jest.fn(() => Promise.resolve()),
  };
  const membership = { invalidate: jest.fn() };
  const users = {
    getUserByTelegramId: jest.fn((id: number) =>
      Promise.resolve(id === applicant.telegramId ? applicant : null),
    ),
  };
  const service = new AdmissionService(
    admissions as unknown as AdmissionRepository,
    telegram as unknown as TelegramBotService,
    membership as unknown as MembershipService,
    users as unknown as UserService,
    { mainChatId: MAIN_CHAT_ID } as ConfigType<typeof telegramBotConfig>,
  );
  return { service, admissions, telegram, membership };
}

const approved = (overrides: Partial<Admission> = {}): Admission => ({
  requestChatId,
  state: 'Approved',
  ...overrides,
});

const joinRequest = (
  userId: number,
  inviteLink: string | undefined = LINK,
) => ({
  chatId: Number(MAIN_CHAT_ID),
  userId,
  inviteLink,
});

describe('AdmissionService', () => {
  describe('issueInviteLink', () => {
    it('crea el enlace con solicitud de unión, lo guarda y lo devuelve', async () => {
      const ctx = setup(approved());

      await expect(ctx.service.issueInviteLink(requestChatId)).resolves.toBe(
        LINK,
      );

      expect(ctx.telegram.createAdmissionLink).toHaveBeenCalledWith(
        '0b6f3c1e8a2d4f5b9c7e1d2e3f4a5b6c',
        expect.any(Date),
      );
      expect(ctx.admissions.saveInviteLink).toHaveBeenCalledWith(
        requestChatId,
        LINK,
        expect.any(Date),
      );
      const [, expiresAt] = ctx.telegram.createAdmissionLink.mock.calls[0];
      const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.99);
      expect(days).toBeLessThanOrEqual(7);
    });

    it('si ya tiene enlace no crea otro: reintentar no deja enlaces de más', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));

      await expect(ctx.service.issueInviteLink(requestChatId)).resolves.toBe(
        LINK,
      );
      expect(ctx.telegram.createAdmissionLink).not.toHaveBeenCalled();
    });

    it('si otro proceso guardó un enlace antes, revoca el creado y devuelve el guardado', async () => {
      const ctx = setup(approved());
      ctx.admissions.saveInviteLink.mockResolvedValue(false);
      ctx.admissions.findById
        .mockResolvedValueOnce(approved())
        .mockResolvedValueOnce(approved({ inviteLink: 'https://t.me/+antes' }));

      await expect(ctx.service.issueInviteLink(requestChatId)).resolves.toBe(
        'https://t.me/+antes',
      );
      expect(ctx.telegram.revokeInviteLink).toHaveBeenCalledWith(LINK);
    });

    it.each<[string, Admission | null]>([
      ['no existe', null],
      ['no está aprobada', approved({ state: 'Rejected' })],
      ['ya entró', approved({ inviteLink: LINK, admittedAt: new Date() })],
    ])('no crea nada si la solicitud %s', async (_, stored) => {
      const ctx = setup(stored);

      await expect(
        ctx.service.issueInviteLink(requestChatId),
      ).resolves.toBeUndefined();
      expect(ctx.telegram.createAdmissionLink).not.toHaveBeenCalled();
    });

    it('si Telegram falla al crear el enlace, lanza para que se reintente', async () => {
      const ctx = setup(approved());
      ctx.telegram.createAdmissionLink.mockRejectedValue(new Error('caído'));

      await expect(ctx.service.issueInviteLink(requestChatId)).rejects.toThrow(
        'caído',
      );
      expect(ctx.admissions.saveInviteLink).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinRequest', () => {
    it('acepta al aprobado por su enlace, marca que entró, invalida su rol y revoca el enlace', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));

      await ctx.service.handleJoinRequest(joinRequest(42));

      expect(ctx.telegram.approveJoinRequest).toHaveBeenCalledWith(42);
      expect(ctx.admissions.markAdmitted).toHaveBeenCalledWith(
        requestChatId,
        expect.any(Date),
      );
      expect(ctx.membership.invalidate).toHaveBeenCalledWith(42);
      expect(ctx.telegram.revokeInviteLink).toHaveBeenCalledWith(LINK);
      expect(ctx.telegram.declineJoinRequest).not.toHaveBeenCalled();
    });

    it('si falla revocar, el ingreso igual queda marcado', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));
      ctx.telegram.revokeInviteLink.mockRejectedValue(new Error('caído'));

      await expect(
        ctx.service.handleJoinRequest(joinRequest(42)),
      ).resolves.toBeUndefined();
      expect(ctx.admissions.markAdmitted).toHaveBeenCalled();
    });

    it('si falla aceptar, no marca el ingreso', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));
      ctx.telegram.approveJoinRequest.mockRejectedValue(
        new Error('HIDE_REQUESTER_MISSING'),
      );

      await expect(
        ctx.service.handleJoinRequest(joinRequest(42)),
      ).rejects.toThrow();
      expect(ctx.admissions.markAdmitted).not.toHaveBeenCalled();
      expect(ctx.telegram.revokeInviteLink).not.toHaveBeenCalled();
    });

    it('rechaza a un usuario que no está en la BD', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));

      await ctx.service.handleJoinRequest(joinRequest(77));

      expect(ctx.telegram.declineJoinRequest).toHaveBeenCalledWith(77);
      expect(ctx.admissions.findByRequester).not.toHaveBeenCalled();
    });

    it('rechaza a quien ya entró una vez y vuelve', async () => {
      const ctx = setup(approved({ inviteLink: LINK, admittedAt: new Date() }));

      await ctx.service.handleJoinRequest(joinRequest(42));

      expect(ctx.telegram.declineJoinRequest).toHaveBeenCalledWith(42);
      expect(ctx.telegram.approveJoinRequest).not.toHaveBeenCalled();
      expect(ctx.admissions.markAdmitted).not.toHaveBeenCalled();
    });

    it('ignora solicitudes de unión a otros chats', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));

      await ctx.service.handleJoinRequest({ ...joinRequest(42), chatId: -100 });

      expect(ctx.telegram.approveJoinRequest).not.toHaveBeenCalled();
      expect(ctx.telegram.declineJoinRequest).not.toHaveBeenCalled();
    });
  });

  describe('inviteLinkOf', () => {
    it('devuelve el enlace pendiente del solicitante', async () => {
      const ctx = setup(approved({ inviteLink: LINK }));

      await expect(ctx.service.inviteLinkOf(applicant.id)).resolves.toBe(LINK);
      expect(ctx.admissions.findByRequester).toHaveBeenCalledWith(applicant.id);
    });
  });
});
