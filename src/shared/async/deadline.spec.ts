import { DeadlineExceededError, withDeadline } from './deadline';

describe('withDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resuelve con el valor si llega a tiempo', async () => {
    await expect(withDeadline(Promise.resolve(1), 100)).resolves.toBe(1);
  });

  it('rechaza con DeadlineExceededError si vence, sin cancelar la operación', async () => {
    let finished = false;
    const slow = new Promise<number>((resolve) =>
      setTimeout(() => {
        finished = true;
        resolve(1);
      }, 2_000),
    );

    const result = withDeadline(slow, 100);
    jest.advanceTimersByTime(100);
    await expect(result).rejects.toBeInstanceOf(DeadlineExceededError);

    jest.advanceTimersByTime(1_900);
    await slow;
    expect(finished).toBe(true);
  });

  it('propaga el error de la operación', async () => {
    await expect(
      withDeadline(Promise.reject(new Error('falló')), 100),
    ).rejects.toThrow('falló');
  });
});
