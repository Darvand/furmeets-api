import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MembershipModule } from 'src/membership/membership.module';
import { TelegramBotModule } from 'src/telegram-bot/telegram-bot.module';
import { MediaService } from './application/media.service';
import { MEDIA_STORAGE } from './domain/media-storage.port';
import { MEDIA_REPOSITORY } from './domain/media.repository';
import { MediaMongoRepository } from './infraestructure/media-mongo.repository';
import { Media, MediaSchema } from './infraestructure/media.schema';
import { TelegramStorageAdapter } from './infraestructure/telegram-storage.adapter';
import { MediaController } from './presentation/media.controller';

/**
 * Imágenes en Telegram servidas por el proxy `GET /media/:id` (SPEC §4.3). Solo depende
 * del bot y de la membresía, así `members` y los módulos que vengan pueden importarlo.
 */
@Module({
  imports: [
    TelegramBotModule,
    MembershipModule,
    MongooseModule.forFeature([{ name: Media.name, schema: MediaSchema }]),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    { provide: MEDIA_REPOSITORY, useClass: MediaMongoRepository },
    { provide: MEDIA_STORAGE, useClass: TelegramStorageAdapter },
  ],
  exports: [MediaService],
})
export class MediaModule {}
