import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import { PaymentSchema, PaymentStatusEnum } from '@querobroapp/shared';

@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private async getPaidTotal(
    tx: Prisma.TransactionClient,
    orderId: number,
    excludePaymentId?: number
  ) {
    const where: Prisma.PaymentWhereInput = {
      orderId,
      status: PaymentStatusEnum.enum.PAGO
    };

    if (excludePaymentId) {
      where.id = { not: excludePaymentId };
    }

    const aggregation = await tx.payment.aggregate({
      where,
      _sum: { amount: true }
    });

    return this.toMoney(aggregation._sum.amount ?? 0);
  }

  private ensureWithinOrderTotal(orderTotal: number, paidCurrent: number, amountToAdd: number) {
    const nextPaid = this.toMoney(paidCurrent + amountToAdd);
    if (nextPaid > this.toMoney(orderTotal) + 0.00001) {
      throw new BadRequestException(
        `Pagamento excede o total do pedido. Total=${this.toMoney(orderTotal)} PagoAtual=${paidCurrent} NovoPagamento=${amountToAdd}`
      );
    }
  }

  list() {
    return this.prisma.payment.findMany({ orderBy: { id: 'desc' } });
  }

  async create(payload: unknown) {
    const data = PaymentSchema.omit({ id: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');

      const isPaid = data.status === PaymentStatusEnum.enum.PAGO || Boolean(data.paidAt);
      const amountToAdd = isPaid ? this.toMoney(data.amount) : 0;
      const paidCurrent = await this.getPaidTotal(tx, data.orderId);
      this.ensureWithinOrderTotal(order.total, paidCurrent, amountToAdd);

      return tx.payment.create({
        data: {
          orderId: data.orderId,
          amount: this.toMoney(data.amount),
          method: data.method,
          status: isPaid ? PaymentStatusEnum.enum.PAGO : data.status,
          paidAt: data.paidAt ? new Date(data.paidAt) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          providerRef: data.providerRef ?? null
        }
      });
    });
  }

  async markPaid(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException('Pagamento nao encontrado');

      if (payment.status === PaymentStatusEnum.enum.PAGO) {
        return payment;
      }

      const order = await tx.order.findUnique({ where: { id: payment.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');

      const paidCurrent = await this.getPaidTotal(tx, payment.orderId, payment.id);
      this.ensureWithinOrderTotal(order.total, paidCurrent, this.toMoney(payment.amount));

      return tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatusEnum.enum.PAGO,
          paidAt: new Date()
        }
      });
    });
  }

  async remove(id: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento nao encontrado');
    await this.prisma.payment.delete({ where: { id } });
  }
}
