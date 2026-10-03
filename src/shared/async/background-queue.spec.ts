import { Logger } from '@nestjs/common';
import {
  createTimingStore,
  currentTiming,
  runWithTiming,
} from '../timing/timing-context';
import { BackgroundQueue } from './background-queue';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('BackgroundQueue', () => {
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger & { warn: jest.Mock; error: jest.Mock };

  beforeEach(() => jest.clearAllMocks());

  it('vuelve de inmediato aunque la tarea tarde', async () => {
    const queue = new BackgroundQueue(logger);
    let done = false;

    const startedAt = Date.now();
    queue.enqueue('lenta', async () => {
      await sleep(200);
      done = true;
    });

    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(done).toBe(false);
    await queue.drain();
    expect(done).toBe(true);
  });

  it('ejecuta las tareas de a una, en orden de llegada', async () => {
    const queue = new BackgroundQueue(logger);
    const order: string[] = [];

    queue.enqueue('a', async () => {
      await sleep(30);
      order.push('a');
    });
    queue.enqueue('b', () => Promise.resolve(void order.push('b')));
    await queue.drain();

    expect(order).toEqual(['a', 'b']);
  });

  it('reintenta y, si se agotan los intentos, registra el error y sigue', async () => {
    const queue = new BackgroundQueue(logger, { attempts: 3, retryDelayMs: 1 });
    const failing = jest.fn(() => Promise.reject(new Error('Telegram caído')));
    const next = jest.fn(() => Promise.resolve());

    queue.enqueue('aviso', failing);
    queue.enqueue('siguiente', next);
    await queue.drain();

    expect(failing).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Telegram caído'),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('se detiene en cuanto un reintento funciona', async () => {
    const queue = new BackgroundQueue(logger, { retryDelayMs: 1 });
    const flaky = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(undefined);

    queue.enqueue('aviso', flaky);
    await queue.drain();

    expect(flaky).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('respeta los intentos de cada tarea', async () => {
    const queue = new BackgroundQueue(logger, { retryDelayMs: 1 });
    const once = jest.fn(() => Promise.reject(new Error('no repetir')));

    queue.enqueue('cierre', once, { attempts: 1 });
    await queue.drain();

    expect(once).toHaveBeenCalledTimes(1);
  });

  it('descarta con error lo que no cabe', async () => {
    const queue = new BackgroundQueue(logger, { maxPending: 1 });
    const task = jest.fn(() => sleep(10));

    queue.enqueue('primera', task);
    queue.enqueue('segunda', task);
    await queue.drain();

    expect(task).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('segunda'),
    );
  });

  it('drain también espera lo que encola una tarea', async () => {
    const queue = new BackgroundQueue(logger);
    const inner = jest.fn(() => Promise.resolve());

    queue.enqueue('externa', () => {
      queue.enqueue('interna', inner);
      return Promise.resolve();
    });
    await queue.drain();

    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('la tarea corre fuera del contexto de medición de quien la encola', async () => {
    const queue = new BackgroundQueue(logger);
    let seen: unknown = 'sin ejecutar';

    runWithTiming(createTimingStore(), () =>
      queue.enqueue('aviso', () => {
        seen = currentTiming();
        return Promise.resolve();
      }),
    );
    await queue.drain();

    expect(seen).toBeUndefined();
  });

  it('al apagar espera las tareas pendientes, con un límite', async () => {
    const queue = new BackgroundQueue(logger, { drainTimeoutMs: 20 });
    queue.enqueue('eterna', () => new Promise<void>(() => undefined));

    await queue.onModuleDestroy();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sin terminar'),
    );
  });
});
