import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module.js';
import { ProductionModule } from '../production/production.module.js';
import { AlexaController } from './alexa.controller.js';
import { AlexaOauthService } from './alexa-oauth.service.js';
import { AlexaService } from './alexa.service.js';

@Module({
  imports: [AutomationsModule, ProductionModule],
  controllers: [AlexaController],
  providers: [AlexaService, AlexaOauthService]
})
export class AlexaModule {}
