import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { PaymentSchema, PaymentStatusEnum } from '@querobroapp/shared';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.payment.findMany({ orderBy: { id: 'desc' } });
  }

  async create(payload: unknown) {
    const data = PaymentSchema.omit({ id: true }).parse(payload);
    const order = await this.prisma.order.findUnique({ where: { id: data.orderId } });
    if (!order) throw new NotFoundException('Pedido nao encontrado');

    return this.prisma.payment.create({
      data: {
        orderId: data.orderId,
        amount: data.amount,
        method: data.method,
        status: data.status,
        paidAt: data.paidAt ? new Date(data.paidAt) : null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        providerRef: data.providerRef ?? null
      }
    });
  }

  async markPaid(id: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento nao encontrado');

    return this.prisma.payment.update({
      where: { id },
      data: {
        status: PaymentStatusEnum.enum.PAGO,
        paidAt: new Date()
      }
    });
  }
}
