import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  type Admission,
  admissionLinkName,
  admissionLinkExpiry,
  decideJoinRequest,
  needsInviteLink,
  pendingInviteLink,
} from './admission';

const LINK = 'https://t.me/+AbCdEf_123';
const id = UUID.from('0b6f3c1e-8a2d-4f5b-9c7e-1d2e3f4a5b6c');

const admission = (overrides: Partial<Admission> = {}): Admission => ({
  requestChatId: id,
  state: 'Approved',
  inviteLink: LINK,
  ...overrides,
});

describe('decideJoinRequest', () => {
  it('acepta al aprobado que llega por su enlace', () => {
    expect(decideJoinRequest(admission(), LINK)).toEqual({
      approve: true,
      admission: admission(),
    });
  });

  it.each<[string, Admission | null, string | undefined, string]>([
    ['sin solicitud', null, LINK, 'sin-solicitud'],
    ['en curso', admission({ state: 'InProgress' }), LINK, 'no-aprobada'],
    ['rechazada', admission({ state: 'Rejected' }), LINK, 'no-aprobada'],
    [
      'ya entró una vez (salió y vuelve)',
      admission({ admittedAt: new Date() }),
      LINK,
      'ya-ingreso',
    ],
    [
      'aprobada antes de T25, sin enlace',
      admission({ inviteLink: undefined }),
      LINK,
      'sin-enlace',
    ],
    ['por otro enlace', admission(), 'https://t.me/+otro', 'otro-enlace'],
    [
      'sin enlace en la solicitud de unión',
      admission(),
      undefined,
      'otro-enlace',
    ],
  ])('rechaza: %s', (_, value, used, reason) => {
    expect(decideJoinRequest(value, used)).toEqual({ approve: false, reason });
  });
});

const NOW = new Date('2026-11-17T12:00:00Z');
const WEEK_AFTER = new Date('2026-11-24T12:00:00Z');

describe('vencimiento del enlace', () => {
  it('vence a los 7 días', () => {
    expect(admissionLinkExpiry(NOW)).toEqual(WEEK_AFTER);
  });

  it('sirve hasta su vencimiento y no después', () => {
    const linked = admission({ inviteExpiresAt: WEEK_AFTER });
    const justBefore = new Date(WEEK_AFTER.getTime() - 1);

    expect(decideJoinRequest(linked, LINK, justBefore).approve).toBe(true);
    expect(pendingInviteLink(linked, justBefore)).toBe(LINK);
    expect(decideJoinRequest(linked, LINK, WEEK_AFTER)).toEqual({
      approve: false,
      reason: 'enlace-vencido',
    });
    expect(pendingInviteLink(linked, WEEK_AFTER)).toBe(undefined);
  });

  it('un vencido no cuenta como faltante: no se emite otro solo', () => {
    expect(needsInviteLink(admission({ inviteExpiresAt: new Date(0) }))).toBe(
      false,
    );
  });
});

describe('pendingInviteLink', () => {
  it('solo para el aprobado que no entró', () => {
    expect(pendingInviteLink(admission())).toBe(LINK);
    expect(pendingInviteLink(admission({ admittedAt: new Date() }))).toBe(
      undefined,
    );
    expect(pendingInviteLink(admission({ state: 'Rejected' }))).toBe(undefined);
    expect(pendingInviteLink(null)).toBe(undefined);
  });
});

describe('needsInviteLink', () => {
  it('aprobada, sin enlace y sin haber entrado', () => {
    expect(needsInviteLink(admission({ inviteLink: undefined }))).toBe(true);
    expect(needsInviteLink(admission())).toBe(false);
    expect(
      needsInviteLink(
        admission({ inviteLink: undefined, admittedAt: new Date() }),
      ),
    ).toBe(false);
    expect(
      needsInviteLink(
        admission({ inviteLink: undefined, state: 'InProgress' }),
      ),
    ).toBe(false);
    expect(needsInviteLink(null)).toBe(false);
  });
});

describe('admissionLinkName', () => {
  it('es el id sin guiones: 32 caracteres, el máximo de Telegram', () => {
    const name = admissionLinkName(id);
    expect(name).toBe('0b6f3c1e8a2d4f5b9c7e1d2e3f4a5b6c');
    expect(name).toHaveLength(32);
  });
});
