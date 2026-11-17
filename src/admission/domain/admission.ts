import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  RequestChatState,
  type RequestChatStateType,
} from 'src/chat/domain/value-objects/request-chat-state.value-object';

/** Lo que importa de una solicitud para admitir a su solicitante en el grupo. */
export interface Admission {
  requestChatId: UUID;
  state: RequestChatStateType;
  /** Enlace de admisión. Falta si la solicitud no está aprobada o es anterior a T25. */
  inviteLink?: string;
  /** Cuándo entró al grupo con su enlace (*ingresó*). */
  admittedAt?: Date;
}

/** Por qué se rechaza una solicitud de unión. Va a los logs, sin datos personales. */
export type JoinRequestRejection =
  | 'sin-solicitud'
  | 'no-aprobada'
  | 'ya-ingreso'
  | 'sin-enlace'
  | 'otro-enlace';

export type JoinRequestDecision =
  | { approve: true; admission: Admission & { inviteLink: string } }
  | { approve: false; reason: JoinRequestRejection };

const APPROVED = RequestChatState.Approved().props.value;

/**
 * Decide una solicitud de unión al grupo (SPEC §3.4). Solo entra quien tiene una
 * solicitud aprobada, todavía no usó su enlace, y llega por **ese** enlace. Cualquier
 * otro caso se rechaza: otra cuenta con el enlace, un enlace ajeno, o quien ya entró
 * una vez y vuelve después de salir (el enlace ya se revocó y no se emite otro).
 */
export function decideJoinRequest(
  admission: Admission | null,
  usedLink: string | undefined,
): JoinRequestDecision {
  if (!admission) {
    return { approve: false, reason: 'sin-solicitud' };
  }
  if (admission.state !== APPROVED) {
    return { approve: false, reason: 'no-aprobada' };
  }
  if (admission.admittedAt) {
    return { approve: false, reason: 'ya-ingreso' };
  }
  const { inviteLink } = admission;
  if (!inviteLink) {
    return { approve: false, reason: 'sin-enlace' };
  }
  if (usedLink !== inviteLink) {
    return { approve: false, reason: 'otro-enlace' };
  }
  return { approve: true, admission: { ...admission, inviteLink } };
}

/** El enlace que el solicitante todavía puede usar: aprobado y sin haber entrado. */
export function pendingInviteLink(
  admission: Admission | null,
): string | undefined {
  if (!admission || admission.state !== APPROVED || admission.admittedAt) {
    return undefined;
  }
  return admission.inviteLink;
}

/** Si a la solicitud le falta su enlace de admisión. */
export function needsInviteLink(admission: Admission | null): boolean {
  return (
    !!admission &&
    admission.state === APPROVED &&
    !admission.admittedAt &&
    !admission.inviteLink
  );
}

/**
 * Nombre del enlace en Telegram: el id de la solicitud sin guiones (32 caracteres, el
 * máximo que admite `name`). Así un admin reconoce de qué solicitud es.
 */
export function admissionLinkName(requestChatId: UUID): string {
  return requestChatId.value.replace(/-/g, '');
}
