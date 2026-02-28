import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../security/roles.decorator.js';
import { VoiceService } from './voice.service.js';

@Controller('voice')
@Roles('admin', 'operator')
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly service: VoiceService) {}

  @Post('realtime/session')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createRealtimeSession(
    @Body() body: unknown,
    @Headers('x-voice-token') voiceToken?: string,
    @Headers('x-automations-token') automationsToken?: string,
    @Headers('x-receipts-token') receiptsToken?: string
  ) {
    return this.service.createRealtimeSession(body, voiceToken || automationsToken || receiptsToken);
  }

  @Post('command')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  parseCommand(
    @Body() body: unknown,
    @Headers('x-voice-token') voiceToken?: string,
    @Headers('x-automations-token') automationsToken?: string,
    @Headers('x-receipts-token') receiptsToken?: string
  ) {
    return this.service.parseOperationalCommand(body, voiceToken || automationsToken || receiptsToken);
  }
}
