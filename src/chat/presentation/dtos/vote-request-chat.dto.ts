/**
 * Respuesta de un voto: solo estado y conteos, sin mensajes ni solicitante, para que
 * votar no tenga que leer la solicitud completa (RNF-REN-07). Si el voto la cerró, la
 * solicitud con el mensaje de cierre llega después por `request-chat-update`.
 */
export class VoteRequestChatDto {
  uuid: string;
  state: string;
  votes: {
    approved: number;
    rejected: number;
  };
  userVote?: string;
}

/**
 * Evento `request-chat-votes`, a la sala de miembros tras cada voto: estado y conteos.
 * No lleva `userVote`: cada miembro conoce solo el suyo (RNF-PRI-01).
 */
export type RequestChatVotesEventDto = Omit<VoteRequestChatDto, 'userVote'>;
