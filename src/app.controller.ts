import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/presentation/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
