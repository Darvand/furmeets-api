import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import databaseConfig from './database.config';
import { instrumentMongoTiming } from '../shared/timing/mongo-timing';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      useFactory: (config: ConfigType<typeof databaseConfig>) => {
        Logger.log(`Connecting to database: ${config.uri}`);
        return {
          uri: config.uri,
          // Tiempo de Mongo por petición en los logs de timing (RNF-OBS-03)
          monitorCommands: true,
          connectionFactory: instrumentMongoTiming,
        };
      },
      inject: [databaseConfig.KEY],
      imports: [ConfigModule],
    }),
  ],
})
export class DatabaseModule {}
