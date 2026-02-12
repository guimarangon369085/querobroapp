import { Body, Controller, Header, Headers, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ReceiptsService } from './receipts.service.js';

@Controller('receipts')
export class ReceiptsController {
  constructor(@Inject(ReceiptsService) private readonly service: ReceiptsService) {}

  @Post('parse')
  @Throttle({ default: { limit: 18, ttl: 60_000 } })
  parse(@Body() body: unknown, @Headers('x-receipts-token') token?: string) {
    return this.service.parse(body, token);
  }

  @Post('ingest')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  ingest(
    @Body() body: unknown,
    @Headers('x-receipts-token') token?: string,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    return this.service.ingest(body, token, idempotencyKey);
  }

  @Post('ingest-notification')
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async ingestNotification(
    @Body() body: unknown,
    @Headers('x-receipts-token') token?: string,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    const result = await this.service.ingest(body, token, idempotencyKey);
    return `Itens lancados: ${result.ingest.appliedCount} | Ignorados: ${result.ingest.ignoredCount}`;
  }

  @Post('parse-clipboard')
  @Throttle({ default: { limit: 18, ttl: 60_000 } })
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async parseClipboard(@Body() body: unknown, @Headers('x-receipts-token') token?: string) {
    const result = await this.service.parse(body, token);
    return result.clipboardText;
  }

  @Post('supplier-prices/sync')
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  syncSupplierPrices(@Headers('x-receipts-token') token?: string) {
    return this.service.syncSupplierPrices(token);
  }
}
