import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service.js';
import {
  moneyToMinorUnits,
  PaymentSchema,
  PaymentStatusEnum,
  PixChargeSchema,
  roundMoney
} from '@querobroapp/shared';

type TransactionClient = Prisma.TransactionClient;
type PaymentRecord = {
  id: number;
  orderId: number;
  amount: number;
  method: string;
  status: string;
  paidAt: Date | null;
  dueDate: Date | null;
  providerRef: string | null;
};

@Injectable()
export class PaymentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private toMoney(value: number) {
    return roundMoney(value);
  }

  private getConfiguredPixProvider() {
    const explicit = (process.env.PIX_PROVIDER || '').trim().toUpperCase();
    if (explicit === 'STATIC_PIX') return 'STATIC_PIX' as const;
    if (explicit === 'LOCAL_DEV') return 'LOCAL_DEV' as const;
    if (this.hasStaticPixConfig()) return 'STATIC_PIX' as const;
    return 'LOCAL_DEV' as const;
  }

  private hasStaticPixConfig() {
    return Boolean(
      (process.env.PIX_STATIC_KEY || '').trim() &&
        (process.env.PIX_RECEIVER_NAME || '').trim() &&
        (process.env.PIX_RECEIVER_CITY || '').trim()
    );
  }

  private pad2(value: number) {
    return String(value).padStart(2, '0');
  }

  private pixField(id: string, value: string) {
    return `${id}${this.pad2(value.length)}${value}`;
  }

  private sanitizePixText(value: string, maxLength: number) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 .,/:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized.slice(0, maxLength) || 'QUERO BROA';
  }

  private crc16Ccitt(payload: string) {
    let crc = 0xffff;

    for (let i = 0; i < payload.length; i += 1) {
      crc ^= payload.charCodeAt(i) << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }

    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  private stablePixTxid(orderId: number, paymentId: number) {
    const orderPart = orderId.toString(36).toUpperCase();
    const paymentPart = paymentId.toString(36).toUpperCase();
    return `QB${orderPart}P${paymentPart}`.slice(0, 25);
  }

  private buildProviderRef(provider: 'STATIC_PIX' | 'LOCAL_DEV', txid: string) {
    return `${provider}:${txid}`;
  }

  private parseProviderRef(providerRef?: string | null) {
    const raw = providerRef?.trim();
    if (!raw) return null;
    const separator = raw.indexOf(':');
    if (separator <= 0) return null;
    const provider = raw.slice(0, separator).toUpperCase();
    const txid = raw.slice(separator + 1).trim();
    if (!txid) return null;
    if (provider !== 'STATIC_PIX' && provider !== 'LOCAL_DEV') return null;
    return { provider: provider as 'STATIC_PIX' | 'LOCAL_DEV', txid };
  }

  private buildStaticPixCopyPaste(input: { txid: string; amount: number }) {
    const pixKey = this.normalizeStaticPixKey(process.env.PIX_STATIC_KEY || '');
    const receiverName = this.sanitizePixText(process.env.PIX_RECEIVER_NAME || 'QUERO BROA', 25);
    const receiverCity = this.sanitizePixText(process.env.PIX_RECEIVER_CITY || 'BELO HORIZONTE', 15);
    const descriptionPrefix = this.sanitizePixText(process.env.PIX_DESCRIPTION_PREFIX || 'PEDIDO', 20);
    const amount = this.toMoney(input.amount);
    const description = `${descriptionPrefix} ${input.txid}`.slice(0, 60).trim();

    const merchantAccountInfo =
      this.pixField('00', 'br.gov.bcb.pix') +
      this.pixField('01', pixKey) +
      this.pixField('02', description);

    const additionalData = this.pixField('05', input.txid);

    const payload =
      this.pixField('00', '01') +
      this.pixField('01', '11') +
      this.pixField('26', merchantAccountInfo) +
      this.pixField('52', '0000') +
      this.pixField('53', '986') +
      this.pixField('54', amount.toFixed(2)) +
      this.pixField('58', 'BR') +
      this.pixField('59', receiverName) +
      this.pixField('60', receiverCity) +
      this.pixField('62', additionalData) +
      '6304';

    return `${payload}${this.crc16Ccitt(payload)}`;
  }

  private normalizeStaticPixKey(value: string) {
    const raw = value.trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw.toLowerCase();
    if (/^[0-9a-fA-F-]{32,}$/i.test(raw)) return raw;

    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) {
      return `+55${digits}`;
    }
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
      return `+${digits}`;
    }

    return raw;
  }

  buildPixCharge(payment: PaymentRecord) {
    const parsed = this.parseProviderRef(payment.providerRef);
    const provider = parsed?.provider ?? this.getConfiguredPixProvider();
    const txid = parsed?.txid ?? this.stablePixTxid(payment.orderId, payment.id);
    const providerRef = parsed?.txid
      ? parsed.provider === provider
        ? payment.providerRef || this.buildProviderRef(provider, txid)
        : this.buildProviderRef(parsed.provider, txid)
      : this.buildProviderRef(provider, txid);

    if (provider === 'STATIC_PIX' && this.hasStaticPixConfig()) {
      return PixChargeSchema.parse({
        provider,
        providerRef,
        txid,
        copyPasteCode: this.buildStaticPixCopyPaste({
          txid,
          amount: payment.amount
        }),
        expiresAt: payment.dueDate?.toISOString() ?? null,
        payable: true
      });
    }

    return PixChargeSchema.parse({
      provider: 'LOCAL_DEV',
      providerRef: this.buildProviderRef('LOCAL_DEV', txid),
      txid,
      copyPasteCode: `LOCALDEV|PIX|${txid}|${this.toMoney(payment.amount).toFixed(2)}`,
      expiresAt: payment.dueDate?.toISOString() ?? null,
      payable: false
    });
  }

  private normalizePayment(payment: PaymentRecord) {
    const pixCharge = payment.method === 'pix' ? this.buildPixCharge(payment) : null;

    return PaymentSchema.parse({
      ...payment,
      method: 'pix',
      paidAt: payment.paidAt?.toISOString() ?? null,
      dueDate: payment.dueDate?.toISOString() ?? null,
      providerRef: payment.providerRef,
      pixCharge
    });
  }

  private async getPaidTotal(
    tx: TransactionClient,
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
    const nextPaid = moneyToMinorUnits(paidCurrent) + moneyToMinorUnits(amountToAdd);
    if (nextPaid > moneyToMinorUnits(orderTotal)) {
      throw new BadRequestException(
        `Pagamento excede o total do pedido. Total=${this.toMoney(orderTotal)} PagoAtual=${paidCurrent} NovoPagamento=${amountToAdd}`
      );
    }
  }

  async ensurePixChargeOnRecord(tx: TransactionClient, payment: PaymentRecord) {
    if (payment.method !== 'pix' || payment.status === PaymentStatusEnum.enum.PAGO || payment.paidAt) {
      return payment;
    }

    const currentProviderRef = this.parseProviderRef(payment.providerRef)
      ? payment.providerRef
      : this.buildProviderRef(this.getConfiguredPixProvider(), this.stablePixTxid(payment.orderId, payment.id));

    if (currentProviderRef === payment.providerRef) {
      return {
        ...payment,
        providerRef: currentProviderRef
      };
    }

    return tx.payment.update({
      where: { id: payment.id },
      data: { providerRef: currentProviderRef }
    }) as Promise<PaymentRecord>;
  }

  async getPaymentPixCharge(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException('Pagamento nao encontrado.');
    }

    const normalized =
      payment.status !== PaymentStatusEnum.enum.PAGO && !payment.paidAt
        ? await this.prisma.$transaction((tx) => this.ensurePixChargeOnRecord(tx, payment as PaymentRecord))
        : (payment as PaymentRecord);

    return this.buildPixCharge(normalized);
  }

  async getOrderPixCharge(orderId: number) {
    const payments = await this.prisma.payment.findMany({
      where: { orderId, method: 'pix' },
      orderBy: { id: 'desc' }
    });
    const payment =
      payments.find((entry) => entry.status !== PaymentStatusEnum.enum.PAGO && !entry.paidAt) ?? payments[0];

    if (!payment) {
      throw new NotFoundException('Pedido nao possui cobranca PIX.');
    }

    const normalized =
      payment.status !== PaymentStatusEnum.enum.PAGO && !payment.paidAt
        ? await this.prisma.$transaction((tx) => this.ensurePixChargeOnRecord(tx, payment as PaymentRecord))
        : (payment as PaymentRecord);

    return this.buildPixCharge(normalized);
  }

  list() {
    return this.prisma.payment
      .findMany({ orderBy: { id: 'desc' } })
      .then((payments) => payments.map((payment) => this.normalizePayment(payment as PaymentRecord)));
  }

  async create(payload: unknown) {
    const data = PaymentSchema.omit({ id: true, pixCharge: true }).parse(payload);
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: data.orderId } });
      if (!order) throw new NotFoundException('Pedido nao encontrado');
      if (order.status === 'CANCELADO') {
        throw new BadRequestException('Nao e possivel registrar pagamento para pedido cancelado.');
      }

      const amount = this.toMoney(data.amount);
      if (amount <= 0) {
        throw new BadRequestException('Valor do pagamento deve ser maior que zero.');
      }

      const isPaid = data.status === PaymentStatusEnum.enum.PAGO || Boolean(data.paidAt);
      const amountToAdd = isPaid ? amount : 0;
      const paidCurrent = await this.getPaidTotal(tx, data.orderId);
      this.ensureWithinOrderTotal(order.total, paidCurrent, amountToAdd);

      const created = (await tx.payment.create({
        data: {
          orderId: data.orderId,
          amount,
          method: 'pix',
          status: isPaid ? PaymentStatusEnum.enum.PAGO : data.status,
          paidAt: isPaid ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          providerRef: data.providerRef ?? null
        }
      })) as PaymentRecord;

      const normalized = isPaid ? created : await this.ensurePixChargeOnRecord(tx, created);
      return this.normalizePayment(normalized);
    });
  }

  async remove(id: number) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) throw new NotFoundException('Pagamento nao encontrado');
    await this.prisma.payment.delete({ where: { id } });
  }
}
