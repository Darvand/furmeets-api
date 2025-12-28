import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import databaseConfig from './database.config';

@Module({
    imports: [
        MongooseModule.forRootAsync({
            useFactory: async (config: ConfigType<typeof databaseConfig>) => {
                Logger.log(`Connecting to database: ${config.uri}`);
                return {
                    uri: config.uri,
                };
            },
            inject: [databaseConfig.KEY],
            imports: [ConfigModule],
        }),
    ],
})
export class DatabaseModule { }