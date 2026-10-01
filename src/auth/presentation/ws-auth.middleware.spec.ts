import { Logger } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { InitDataAuthService } from '../application/init-data-auth.service';
import { InvalidInitDataError } from '../domain/init-data.validator';
import {
  AuthenticatedSocket,
  WS_UNAUTHORIZED,
  wsAuthMiddleware,
} from './ws-auth.middleware';

const user = UserEntity.create({ name: 'Ana', telegramId: 42, isMember: true });

function fakeSocket(auth: Record<string, unknown> | undefined): Socket {
  return { handshake: { auth }, data: {} } as unknown as Socket;
}

/** Ejecuta el middleware y resuelve con el error pasado a `next` (o `undefined`). */
function run(
  authenticate: InitDataAuthService['authenticate'],
  socket: Socket,
): Promise<Error | undefined> {
  const middleware = wsAuthMiddleware({ authenticate } as InitDataAuthService);
  return new Promise((resolve) => middleware(socket, resolve));
}

describe('wsAuthMiddleware', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('acepta la conexión y deja al usuario en socket.data.user', async () => {
    const authenticate = jest.fn().mockResolvedValue(user);
    const socket = fakeSocket({ initData: 'query_id=1&hash=abc' });

    const error = await run(authenticate, socket);

    expect(error).toBeUndefined();
    expect(authenticate).toHaveBeenCalledWith('query_id=1&hash=abc');
    expect((socket as AuthenticatedSocket).data.user).toBe(user);
  });

  it('rechaza la conexión con un error genérico y registra el motivo', async () => {
    const authenticate = jest
      .fn()
      .mockRejectedValue(new InvalidInitDataError('expired'));
    const socket = fakeSocket({ initData: 'auth_date=1&hash=abc' });

    const error = await run(authenticate, socket);

    expect(error?.message).toBe(WS_UNAUTHORIZED);
    expect((socket as AuthenticatedSocket).data.user).toBeUndefined();
    const logged = (warn.mock.calls as unknown[][])
      .map((args) => String(args[0]))
      .join('\n');
    expect(logged).toContain('expired');
    expect(logged).not.toContain('auth_date=1');
  });

  it('pasa al servicio un handshake sin auth, que lo rechaza', async () => {
    const authenticate = jest
      .fn()
      .mockRejectedValue(new InvalidInitDataError('missing'));

    const error = await run(authenticate, fakeSocket(undefined));

    expect(authenticate).toHaveBeenCalledWith(undefined);
    expect(error?.message).toBe(WS_UNAUTHORIZED);
  });

  it('rechaza la conexión si falla algo inesperado (p. ej. la BD)', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const authenticate = jest.fn().mockRejectedValue(new Error('mongo caído'));

    const error = await run(authenticate, fakeSocket({ initData: 'x' }));

    expect(error?.message).toBe(WS_UNAUTHORIZED);
    expect(errorLog).toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
