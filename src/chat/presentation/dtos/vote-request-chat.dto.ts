import type { VoteType } from 'src/review/domain/vote';

/**
 * La votación de una solicitud: anónima, sin quién votó (RNF-PRI-01). Solo la reciben los
 * miembros: ninguna salida dirigida al solicitante la incluye mientras no sea miembro
 * (RNF-PRI-03).
 */
export class RequestChatVotingDto {
  votes: {
    approved: number;
    rejected: number;
  };
  /** Votos que cierran la solicitud: al llegar a uno, se aprueba o se rechaza. */
  thresholds: {
    approve: number;
    reject: number;
  };
}

/**
 * Respuesta de un voto: estado y votación, sin mensajes ni solicitante, para que votar no
 * tenga que leer la solicitud completa (RNF-REN-07). Si el voto la cerró, la solicitud
 * llega después por `request-chat-update`.
 */
export class VoteRequestChatDto extends RequestChatVotingDto {
  uuid: string;
  state: string;
  /** El voto de quien votó; falta si lo retiró. */
  userVote?: VoteType;
}

/**
 * Evento `request-chat-votes`, a la sala de miembros tras cada voto: estado y votación.
 * No lleva `userVote` porque lo reciben todos; cada miembro sabe cuál es el suyo.
 */
export type RequestChatVotesEventDto = Omit<VoteRequestChatDto, 'userVote'>;
