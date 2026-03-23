import { Controller, Get, Inject } from '@nestjs/common';
import { RuntimeConfigService } from './runtime-config.service.js';

@Controller()
export class RuntimeConfigController {
  constructor(@Inject(RuntimeConfigService) private readonly service: RuntimeConfigService) {}

  @Get('runtime-config')
  getConfig() {
    return this.service.getConfig();
  }

  @Get('builder/config')
  getLegacyBuilderConfig() {
    return this.service.getConfig();
  }
}
