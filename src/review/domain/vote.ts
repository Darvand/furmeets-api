import type { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

export const VOTE_TYPES = ['approve', 'reject'] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

/**
 * El voto de un miembro. Se guarda quién votó para que cada miembro tenga un solo voto y
 * pueda cambiarlo o retirarlo, pero nadie más lo ve: los votos son anónimos (SPEC §3.3).
 */
export interface Vote {
  voterId: UUID;
  type: VoteType;
}

/** Conteos de votos de una solicitud. */
export interface VoteTally {
  approved: number;
  rejected: number;
}

/** Votos que hacen falta para aprobar o rechazar una solicitud (SPEC §3.3). */
export interface VoteThresholds {
  approve: number;
  reject: number;
}

export const DEFAULT_VOTE_THRESHOLDS: Readonly<VoteThresholds> = Object.freeze({
  approve: 5,
  reject: 5,
});

/** `APPROVE_THRESHOLD` o `REJECT_THRESHOLD` no es un entero positivo. */
export class InvalidVoteThresholdError extends Error {
  constructor(name: string, value: string) {
    super(`${name} must be a positive integer, got "${value}"`);
    this.name = InvalidVoteThresholdError.name;
  }
}

/**
 * Umbrales de `APPROVE_THRESHOLD` y `REJECT_THRESHOLD`; el que falte vale 5. Lanza si
 * alguno no es un entero positivo: con un umbral inválido ninguna solicitud se cerraría.
 */
export function voteThresholdsFrom(
  env: Record<string, string | undefined>,
): VoteThresholds {
  const read = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new InvalidVoteThresholdError(name, raw);
    }
    return value;
  };
  return {
    approve: read('APPROVE_THRESHOLD', DEFAULT_VOTE_THRESHOLDS.approve),
    reject: read('REJECT_THRESHOLD', DEFAULT_VOTE_THRESHOLDS.reject),
  };
}

/** Los votos de una solicitud, uno por miembro. Hacia afuera solo salen conteos. */
export class Votes {
  private constructor(private readonly list: readonly Vote[]) {}

  static of(list: readonly Vote[]): Votes {
    return new Votes([...list]);
  }

  static none(): Votes {
    return new Votes([]);
  }

  all(): readonly Vote[] {
    return this.list;
  }

  tally(): VoteTally {
    return {
      approved: this.count('approve'),
      rejected: this.count('reject'),
    };
  }

  /** El voto de `voter`, si votó: cada miembro conoce solo el suyo. */
  typeOf(voter: UUID): VoteType | undefined {
    return this.list.find((vote) => vote.voterId.equals(voter))?.type;
  }

  /**
   * La opción que alcanzó su umbral, si alguna. Cada voto cambia un solo conteo, así que
   * gana la primera en llegar; si las dos están arriba (umbrales bajados con la solicitud
   * en curso), gana aprobar.
   */
  winner(thresholds: VoteThresholds): VoteType | undefined {
    const { approved, rejected } = this.tally();
    if (approved >= thresholds.approve) {
      return 'approve';
    }
    if (rejected >= thresholds.reject) {
      return 'reject';
    }
    return undefined;
  }

  private count(type: VoteType): number {
    return this.list.filter((vote) => vote.type === type).length;
  }
}
