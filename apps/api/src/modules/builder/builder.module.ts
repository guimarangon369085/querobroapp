import { Module } from '@nestjs/common';
import { BuilderController } from './builder.controller.js';
import { BuilderService } from './builder.service.js';

@Module({
  controllers: [BuilderController],
  providers: [BuilderService],
  exports: [BuilderService],
})
export class BuilderModule {}
