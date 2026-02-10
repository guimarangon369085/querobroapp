import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { OutboxStatusEnum } from '@querobroapp/shared';
import { PrismaService } from '../../prisma.service.js';

@Injectable()
export class WhatsappService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listOutbox(status?: string) {
    let normalizedStatus: string | undefined;
    if (status) {
      try {
        normalizedStatus = OutboxStatusEnum.parse(status.trim().toUpperCase());
      } catch {
        throw new BadRequestException('Status invalido. Use PENDING, SENT ou FAILED.');
      }
    }

    const rows = await this.prisma.outboxMessage.findMany({
      where: normalizedStatus ? { status: normalizedStatus } : undefined,
      orderBy: { id: 'desc' },
    });

    return rows.map((row) => {
      let payload: unknown = row.payload;
      try {
        payload = JSON.parse(row.payload);
      } catch {
        // keep raw string when payload is not valid JSON
      }
      return {
        ...row,
        payload,
      };
    });
  }
}
