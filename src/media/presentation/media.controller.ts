import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { CustomRequest } from 'src/shared/types/custom-request.interface';
import { MediaService } from '../application/media.service';
import { MAX_UPLOAD_BYTES } from '../domain/image-type';
import { UploadedMediaDto } from './dtos/uploaded-media.dto';

/** El navegador guarda la imagen un día; `private` evita que la guarde un proxy compartido. */
const MEDIA_CACHE_CONTROL = 'private, max-age=86400';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /** Sube una imagen (campo `file`, multipart). Más de 10 MB responde 413. */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @Req() req: CustomRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UploadedMediaDto> {
    if (!file) {
      throw new BadRequestException('Missing image in field "file"');
    }
    return { id: await this.mediaService.upload(req.user, file.buffer) };
  }

  @Get(':id')
  async download(
    @Req() req: CustomRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const media = await this.mediaService.open(req.user, id);
    // Después de autorizar: un 403 o 404 no debe quedar en caché.
    res.setHeader('Cache-Control', MEDIA_CACHE_CONTROL);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(media.body, {
      type: media.mimeType,
      length: media.length,
    });
  }
}
