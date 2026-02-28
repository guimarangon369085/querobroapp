import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller.js';
import { VoiceService } from './voice.service.js';
import { AutomationsModule } from '../automations/automations.module.js';

@Module({
  imports: [AutomationsModule],
  controllers: [VoiceController],
  providers: [VoiceService]
})
export class VoiceModule {}
