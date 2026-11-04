/** Quien avala: lo ven todos los miembros (SPEC §3.3). */
export class EndorserDto {
  uuid: string;
  name: string;
  username?: string;
  /** Se pide a `GET /media/:id`. */
  avatarMediaId?: string;
}

/** "Lo conozco, lo avalo": quién y cuándo. */
export class EndorsementDto {
  endorser: EndorserDto;
  /** ISO-8601 UTC. */
  at: string;
}

/**
 * Respuesta de avalar o retirar el aval, y evento `request-chat-endorsements` (solo a la
 * sala de miembros): todos los avales de la solicitud, del más antiguo al más reciente.
 */
export class RequestChatEndorsementsDto {
  uuid: string;
  endorsements: EndorsementDto[];
}
