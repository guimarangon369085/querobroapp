import { Module } from '@nestjs/common';
import { RuntimeConfigController } from './runtime-config.controller.js';
import { RuntimeConfigService } from './runtime-config.service.js';

@Module({
  controllers: [RuntimeConfigController],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService]
})
export class RuntimeConfigModule {}
