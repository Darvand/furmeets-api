import type { UserEntity } from 'src/members/domain/entities/user.entity';
import type { UUID } from 'src/shared/domain/value-objects/uuid.value-object';

export const VOTE_TYPES = ['approve', 'reject'] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

/** El voto de un miembro. Nada es anónimo dentro del grupo (SPEC §3.3). */
export interface Vote {
  voter: UserEntity;
  type: VoteType;
}

/** Conteos de votos de una solicitud. */
export interface VoteTally {
  approved: number;
  rejected: number;
}

/** Quién votó cada opción, en el orden en que votaron. */
export interface VotersByOption {
  approve: UserEntity[];
  reject: UserEntity[];
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

/** Los votos de una solicitud, uno por miembro, en el orden en que votaron. */
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

  voters(): VotersByOption {
    return {
      approve: this.votersOf('approve'),
      reject: this.votersOf('reject'),
    };
  }

  /** El voto de `voter`, si votó. */
  typeOf(voter: UUID): VoteType | undefined {
    return this.list.find((vote) => vote.voter.id.equals(voter))?.type;
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

  private votersOf(type: VoteType): UserEntity[] {
    return this.list
      .filter((vote) => vote.type === type)
      .map((vote) => vote.voter);
  }
}
