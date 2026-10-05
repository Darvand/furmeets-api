import { UserEntity } from 'src/members/domain/entities/user.entity';
import { UUID } from 'src/shared/domain/value-objects/uuid.value-object';
import {
  DEFAULT_VOTE_THRESHOLDS,
  InvalidVoteThresholdError,
  voteThresholdsFrom,
  Votes,
  type VoteType,
} from './vote';

const user = (telegramId: number) =>
  UserEntity.create({ name: `User ${telegramId}`, telegramId, isMember: true });

const [ana, beto, caro, dani] = [1, 2, 3, 4].map(user);

const votes = (...list: [UserEntity, VoteType][]) =>
  Votes.of(list.map(([voter, type]) => ({ voter, type })));

describe('voteThresholdsFrom', () => {
  it('sin variables, los dos umbrales valen 5', () => {
    expect(voteThresholdsFrom({})).toEqual({ approve: 5, reject: 5 });
    expect(DEFAULT_VOTE_THRESHOLDS).toEqual({ approve: 5, reject: 5 });
  });

  it('lee APPROVE_THRESHOLD y REJECT_THRESHOLD por separado', () => {
    expect(
      voteThresholdsFrom({ APPROVE_THRESHOLD: '4', REJECT_THRESHOLD: ' 6 ' }),
    ).toEqual({ approve: 4, reject: 6 });
    expect(voteThresholdsFrom({ REJECT_THRESHOLD: '' })).toEqual({
      approve: 5,
      reject: 5,
    });
  });

  it.each(['0', '-1', '2.5', 'cinco'])(
    'un umbral "%s" no es válido: lanza en vez de no cerrar nunca',
    (value) => {
      expect(() => voteThresholdsFrom({ REJECT_THRESHOLD: value })).toThrow(
        InvalidVoteThresholdError,
      );
    },
  );
});

describe('Votes', () => {
  it('cuenta cada opción y agrupa a los votantes en el orden en que votaron', () => {
    const cast = votes([caro, 'reject'], [ana, 'approve'], [beto, 'approve']);

    expect(cast.tally()).toEqual({ approved: 2, rejected: 1 });
    expect(cast.voters()).toEqual({ approve: [ana, beto], reject: [caro] });
  });

  it('da el voto de cada miembro, por valor de su id', () => {
    const cast = votes([ana, 'approve'], [beto, 'reject']);

    expect(cast.typeOf(UUID.from(ana.id.value))).toBe('approve');
    expect(cast.typeOf(beto.id)).toBe('reject');
    expect(cast.typeOf(dani.id)).toBeUndefined();
  });

  it('sin votos no hay conteos, votantes ni ganador', () => {
    const none = Votes.none();

    expect(none.tally()).toEqual({ approved: 0, rejected: 0 });
    expect(none.voters()).toEqual({ approve: [], reject: [] });
    expect(none.winner(DEFAULT_VOTE_THRESHOLDS)).toBeUndefined();
  });

  describe('winner', () => {
    const thresholds = { approve: 3, reject: 2 };

    it('bajo los dos umbrales no gana nadie', () => {
      expect(
        votes([ana, 'approve'], [beto, 'approve'], [caro, 'reject']).winner(
          thresholds,
        ),
      ).toBeUndefined();
    });

    it('gana aprobar al llegar a su umbral', () => {
      expect(
        votes([ana, 'approve'], [beto, 'approve'], [caro, 'approve']).winner(
          thresholds,
        ),
      ).toBe('approve');
    });

    it('gana rechazar al llegar al suyo, aunque sea distinto del de aprobar', () => {
      expect(votes([ana, 'reject'], [beto, 'reject']).winner(thresholds)).toBe(
        'reject',
      );
    });

    it('si las dos opciones están en su umbral, gana aprobar', () => {
      expect(
        votes([ana, 'approve'], [beto, 'reject']).winner({
          approve: 1,
          reject: 1,
        }),
      ).toBe('approve');
    });
  });
});
