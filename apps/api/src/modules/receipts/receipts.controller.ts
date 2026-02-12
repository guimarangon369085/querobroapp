import { Body, Controller, Header, Headers, Inject, Post } from '@nestjs/common';
import { ReceiptsService } from './receipts.service.js';

@Controller('receipts')
export class ReceiptsController {
  constructor(@Inject(ReceiptsService) private readonly service: ReceiptsService) {}

  @Post('parse')
  parse(@Body() body: unknown, @Headers('x-receipts-token') token?: string) {
    return this.service.parse(body, token);
  }

  @Post('parse-clipboard')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async parseClipboard(@Body() body: unknown, @Headers('x-receipts-token') token?: string) {
    const result = await this.service.parse(body, token);
    return result.clipboardText;
  }
}
