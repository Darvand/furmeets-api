import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { UserService } from 'src/members/application/user.service';
import { UserEntity } from 'src/members/domain/entities/user.entity';
import { TelegramIdentity } from 'src/members/domain/value-objects/telegram-identity.value-object';
import telegramBotConfig from 'src/telegram-bot/telegram-bot.config';
import {
  InvalidInitDataError,
  validateInitData,
} from '../domain/init-data.validator';

/**
 * Autentica a un usuario a partir de un `initData` crudo. Lo usan el guard HTTP y
 * el middleware del socket, así ambos validan exactamente igual (RNF-SEG-01).
 */
@Injectable()
export class InitDataAuthService {
  constructor(
    private readonly userService: UserService,
    @Inject(telegramBotConfig.KEY)
    private readonly config: ConfigType<typeof telegramBotConfig>,
  ) {}

  /** Lanza `InvalidInitDataError` si falta o no es válido. */
  async authenticate(initDataRaw: unknown): Promise<UserEntity> {
    if (typeof initDataRaw !== 'string' || initDataRaw.trim() === '') {
      throw new InvalidInitDataError('missing');
    }
    const { user } = validateInitData(initDataRaw.trim(), this.config.token);
    return this.userService.authenticate(
      TelegramIdentity.create({
        telegramId: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        photoUrl: user.photo_url,
      }),
    );
  }
}
