import type { UserEntity } from 'src/members/domain/entities/user.entity';

/**
 * "Lo conozco, lo avalo" (SPEC §3.3): solo informativo, no afecta la votación. A diferencia
 * de los votos, lleva el nombre de quien avala y lo ven todos los miembros. Uno por miembro;
 * se puede retirar.
 */
export interface Endorsement {
  endorser: UserEntity;
  at: Date;
}
