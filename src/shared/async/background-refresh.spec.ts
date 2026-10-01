import { Logger } from '@nestjs/common';
import { BackgroundRefresh } from './background-refresh';

describe('BackgroundRefresh', () => {
  const warn = jest.fn();
  const logger = { warn } as unknown as Logger;

  it('no espera la tarea y la ejecuta una sola vez dentro del TTL', async () => {
    const refresh = new BackgroundRefresh(60_000, logger);
    const task = jest.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 50)),
    );

    const first = refresh.schedule('user:1', task);
    const second = refresh.schedule('user:1', task);

    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeUndefined();
    await first;
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('registra el fallo y permite reintentar', async () => {
    const refresh = new BackgroundRefresh(60_000, logger);

    await refresh.schedule('group', () => Promise.reject(new Error('caído')));
    const retry = refresh.schedule('group', () => Promise.resolve());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('caído'));
    expect(retry).toBeInstanceOf(Promise);
  });
});
