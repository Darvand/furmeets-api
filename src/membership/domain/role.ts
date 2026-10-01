export const Roles = Object.freeze({
  Member: 'member',
  Applicant: 'applicant',
} as const);

/** Rol en la App: miembro del grupo o solicitante (todo el que no es miembro). */
export type Role = (typeof Roles)[keyof typeof Roles];

/** Lo que importa de un `ChatMember` de Telegram para decidir el rol. */
export interface ChatMemberStatus {
  status: string;
  /** Solo viene en `restricted`: si sigue dentro del grupo. */
  is_member?: boolean;
}

/**
 * Miembro si es creador, administrador, miembro, o restringido que sigue en el grupo.
 * Cualquier otro estado (`left`, `kicked`, `restricted` fuera del grupo) es solicitante.
 */
export function roleFromChatMember(member: ChatMemberStatus): Role {
  switch (member.status) {
    case 'creator':
    case 'administrator':
    case 'member':
      return Roles.Member;
    case 'restricted':
      return member.is_member ? Roles.Member : Roles.Applicant;
    default:
      return Roles.Applicant;
  }
}
