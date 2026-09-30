import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
