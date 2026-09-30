import type { Connection } from 'mongoose';
import { currentTiming, recordMongo, TimingStore } from './timing-context';

type CommandStarted = { requestId: number };
type CommandFinished = { requestId: number; duration: number };

/**
 * Suma el tiempo de cada comando de Mongo al contexto de la petición en curso.
 *
 * Usa el monitoreo de comandos del driver (`monitorCommands: true`), que mide cada
 * comando una sola vez; los hooks de Mongoose contarían dos veces los `populate`.
 * Se usa como `connectionFactory` de `MongooseModule`.
 */
export function instrumentMongoTiming(connection: Connection): Connection {
  const pending = new Map<number, TimingStore>();
  const client = connection.getClient();

  client.on('commandStarted', (event: CommandStarted) => {
    const store = currentTiming();
    if (store) pending.set(event.requestId, store);
  });

  const finish = (event: CommandFinished) => {
    const store = pending.get(event.requestId);
    if (!store) return;
    pending.delete(event.requestId);
    recordMongo(event.duration, store);
  };
  client.on('commandSucceeded', finish);
  client.on('commandFailed', finish);

  return connection;
}
