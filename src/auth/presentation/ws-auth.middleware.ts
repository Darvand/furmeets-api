import { Logger } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { InitDataAuthService } from '../application/init-data-auth.service';
import { InvalidInitDataError } from '../domain/init-data.validator';

/** Socket que pasó `wsAuthMiddleware`: el autor de cualquier evento es `data.user`. */
export interface AuthenticatedSocket extends Socket {
  data: { user: UserEntity };
}

/** Mensaje del `connect_error` que recibe el cliente. No revela el motivo. */
export const WS_UNAUTHORIZED = 'unauthorized';

const logger = new Logger('WsAuth');

/**
 * Middleware de socket.io (RNF-SEG-01, SEG-02). Valida `handshake.auth.initData`
 * antes de aceptar la conexión y deja al usuario en `socket.data.user`. Sin
 * `initData` válido, la conexión se rechaza y el cliente recibe `connect_error`.
 *
 * La validación es por conexión: un socket abierto no se vuelve a validar aunque
 * su `initData` venza (vigencia de 24 h); al reconectar sí.
 *
 * Los rechazos se registran a nivel `warn` con el motivo, sin el `initData` (RNF-OBS-02).
 */
export function wsAuthMiddleware(auth: InitDataAuthService) {
  return (socket: Socket, next: (error?: Error) => void): void => {
    const { initData } = (socket.handshake.auth ?? {}) as {
      initData?: unknown;
    };
    auth.authenticate(initData).then(
      (user) => {
        (socket as AuthenticatedSocket).data.user = user;
        next();
      },
      (error: unknown) => {
        if (error instanceof InvalidInitDataError) {
          logger.warn(`Conexión de socket rechazada: ${error.reason}`);
        } else {
          logger.error('Error al autenticar el socket', error as Error);
        }
        next(new Error(WS_UNAUTHORIZED));
      },
    );
  };
}
