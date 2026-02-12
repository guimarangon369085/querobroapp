import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BuilderService } from './builder.service.js';
import { Roles } from '../../security/roles.decorator.js';

@Controller('builder')
export class BuilderController {
  constructor(@Inject(BuilderService) private readonly service: BuilderService) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig();
  }

  @Put('config')
  @Roles('admin')
  updateConfig(@Body() body: unknown) {
    return this.service.updateConfig(body);
  }

  @Patch('config/:block')
  @Roles('admin')
  updateBlock(@Param('block') block: string, @Body() body: unknown) {
    return this.service.updateBlock(block, body);
  }

  @Post('home-images')
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file'))
  uploadHomeImage(
    @UploadedFile() file: { buffer: Buffer; mimetype?: string; originalname?: string },
    @Body('alt') alt?: string
  ) {
    return this.service.addHomeImage(file, alt);
  }

  @Delete('home-images/:id')
  @Roles('admin')
  removeHomeImage(@Param('id') id: string) {
    return this.service.removeHomeImage(id);
  }
}
