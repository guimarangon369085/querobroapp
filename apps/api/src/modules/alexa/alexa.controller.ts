import { Body, Controller, Get, Header, Headers, Inject, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../security/public.decorator.js';
import { AlexaOauthService } from './alexa-oauth.service.js';
import { AlexaService } from './alexa.service.js';

@Controller('alexa')
export class AlexaController {
  constructor(
    @Inject(AlexaService) private readonly service: AlexaService,
    @Inject(AlexaOauthService) private readonly oauthService: AlexaOauthService
  ) {}

  @Post('bridge')
  @Public()
  @Throttle({ default: { limit: 45, ttl: 60_000 } })
  bridge(
    @Body() body: unknown,
    @Headers('x-alexa-token') alexaToken?: string,
    @Headers('x-alexa-signature') alexaSignature?: string,
    @Headers('x-alexa-timestamp') alexaTimestamp?: string
  ) {
    return this.service.handleBridge(body, {
      token: alexaToken,
      signature: alexaSignature,
      timestamp: alexaTimestamp
    });
  }

  @Get('oauth/authorize')
  @Public()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  authorize(@Query() query: unknown) {
    return this.oauthService.renderAuthorizePage(query);
  }

  @Post('oauth/authorize/approve')
  @Public()
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  async approveAuthorize(@Body() body: unknown, @Res() res: any) {
    const redirectUrl = await this.oauthService.approveAuthorize(body);
    return res.redirect(302, redirectUrl);
  }

  @Post('oauth/token')
  @Public()
  @Throttle({ default: { limit: 25, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  token(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    return this.oauthService.exchangeToken(body, authorization);
  }
}
