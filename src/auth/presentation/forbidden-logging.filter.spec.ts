import { ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';
import { ForbiddenLoggingFilter } from './forbidden-logging.filter';

function host(path: string) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const argumentsHost = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', route: { path }, url: '/x/123' }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { argumentsHost, status, json };
}

describe('ForbiddenLoggingFilter', () => {
  it('registra el 403 en warn con el patrón de ruta (sin la URL) y responde 403', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { argumentsHost, status, json } = host('/request-chats/:id');
    const exception = new ForbiddenException('Requires role member');

    new ForbiddenLoggingFilter().catch(exception, argumentsHost);

    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('Requires role member');
    expect(logged).toContain('GET /request-chats/:id');
    expect(logged).not.toContain('/x/123');
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(exception.getResponse());
    warn.mockRestore();
  });
});
