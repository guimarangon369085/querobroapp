import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { OrderNotificationsService, type DailyDigestOrder } from './order-notifications.service.js';

const DAILY_DIGEST_SCOPE = 'ORDER_DAILY_DIGEST';
const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';
const SAO_PAULO_UTC_OFFSET = '-03:00';

type DailyDigestSendResult = {
  ok: true;
  status: 'SENT' | 'ALREADY_SENT' | 'DISABLED';
  dateKey: string;
  orderCount: number;
  sentAt?: string | null;
};

type DailyDigestPreviewOrder = {
  id: number;
  publicNumber?: number | null;
  status?: string | null;
  scheduledAt?: Date | string | null;
  fulfillmentMode: string;
  total?: number | null;
  paymentStatus?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerAddressLine1?: string | null;
  customerAddressLine2?: string | null;
  customerNeighborhood?: string | null;
  customerDeliveryNotes?: string | null;
  flavorSummary: string;
  whatsappUrl: string | null;
};

type DailyDigestPreviewResult = {
  dateKey: string;
  orderCount: number;
  orders: DailyDigestPreviewOrder[];
};

@Injectable()
export class OrderDailyDigestService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private tickRunning = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrderNotificationsService) private readonly notifications: OrderNotificationsService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.maybeSendTodayDigest();
    }, 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private getRuntimeConfig() {
    const enabledRaw = String(process.env.ORDER_DAILY_DIGEST_ENABLED || '').trim().toLowerCase();
    const explicitTopic = String(process.env.ORDER_DAILY_DIGEST_NTFY_TOPIC_URL || '').trim();
    const sendAtHourRaw = Number.parseInt(String(process.env.ORDER_DAILY_DIGEST_SEND_AT_HOUR || '7'), 10);
    return {
      enabled:
        enabledRaw !== ''
          ? !['0', 'false', 'off', 'no'].includes(enabledRaw)
          : Boolean(explicitTopic),
      sendAtHour: Number.isInteger(sendAtHourRaw) && sendAtHourRaw >= 0 && sendAtHourRaw <= 23 ? sendAtHourRaw : 7
    };
  }

  private getSaoPauloParts(date = new Date()) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: SAO_PAULO_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value])
    );
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      dateKey: `${parts.year}-${parts.month}-${parts.day}`
    };
  }

  private resolveDayBounds(dateKey: string) {
    const [year, month, day] = dateKey.split('-').map((value) => Number.parseInt(value, 10));
    const start = new Date(`${dateKey}T00:00:00${SAO_PAULO_UTC_OFFSET}`);
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 3, 0, 0, 0));
    return {
      start,
      endExclusive: nextDay
    };
  }

  private async alreadySent(dateKey: string) {
    return this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: DAILY_DIGEST_SCOPE,
          idemKey: dateKey
        }
      }
    });
  }

  private async storeSend(dateKey: string, orderCount: number) {
    const sentAt = new Date();
    const expiresAt = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    await this.prisma.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: DAILY_DIGEST_SCOPE,
          idemKey: dateKey
        }
      },
      update: {
        requestHash: `digest:${dateKey}:${orderCount}`,
        responseJson: JSON.stringify({
          dateKey,
          orderCount,
          sentAt: sentAt.toISOString()
        }),
        expiresAt
      },
      create: {
        scope: DAILY_DIGEST_SCOPE,
        idemKey: dateKey,
        requestHash: `digest:${dateKey}:${orderCount}`,
        responseJson: JSON.stringify({
          dateKey,
          orderCount,
          sentAt: sentAt.toISOString()
        }),
        expiresAt
      }
    });
    return sentAt.toISOString();
  }

  private async listOrdersForDate(dateKey: string): Promise<DailyDigestOrder[]> {
    const { start, endExclusive } = this.resolveDayBounds(dateKey);
    const orders = await this.prisma.order.findMany({
      where: {
        status: {
          not: 'CANCELADO'
        },
        OR: [
          {
            scheduledAt: {
              gte: start,
              lt: endExclusive
            }
          },
          {
            scheduledAt: null,
            createdAt: {
              gte: start,
              lt: endExclusive
            }
          }
        ]
      },
      include: {
        customer: true,
        items: {
          include: {
            product: true
          }
        },
        payments: true
      },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
    });

    return orders.map((order) => {
      const currentCustomerName = String(order.customerName || order.customer.name || '').trim() || 'Cliente';
      const currentCustomerPhone = String(order.customerPhone || order.customer.phone || '').trim() || null;
      const currentCustomerAddress = String(order.customerAddress || order.customer.address || '').trim() || null;
      const currentCustomerAddressLine1 =
        String(order.customerAddressLine1 || order.customer.addressLine1 || '').trim() || null;
      const currentCustomerAddressLine2 =
        String(order.customerAddressLine2 || order.customer.addressLine2 || '').trim() || null;
      const currentCustomerNeighborhood =
        String(order.customerNeighborhood || order.customer.neighborhood || '').trim() || null;
      const currentCustomerDeliveryNotes =
        String(order.customerDeliveryNotes || order.customer.deliveryNotes || '').trim() || null;
      return {
        id: order.id,
        publicNumber: order.publicNumber,
        status: order.status,
        fulfillmentMode: order.fulfillmentMode,
        total: order.total,
        deliveryFee: order.deliveryFee,
        scheduledAt: order.scheduledAt,
        createdAt: order.createdAt,
        notes: order.notes,
        paymentStatus: order.payments.some((payment) => payment.status === 'PAGO' || Boolean(payment.paidAt))
          ? 'PAGO'
          : 'PENDENTE',
        customer: {
          name: currentCustomerName,
          phone: currentCustomerPhone,
          // `/confirmacoes` and the WhatsApp confirmation queue must reflect the identity
          // captured on the order, not mutable customer profile data that may change later.
          address: currentCustomerAddress,
          addressLine1: currentCustomerAddressLine1,
          addressLine2: currentCustomerAddressLine2,
          neighborhood: currentCustomerNeighborhood,
          deliveryNotes: currentCustomerDeliveryNotes
        },
        items: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          name: item.product?.name || null
        }))
      };
    });
  }

  async previewForDate(dateKey: string): Promise<DailyDigestPreviewResult> {
    const orders = await this.listOrdersForDate(dateKey);
    return {
      dateKey,
      orderCount: orders.length,
      orders: orders.map((order) => ({
        id: order.id,
        publicNumber: order.publicNumber,
        status: order.status,
        scheduledAt: order.scheduledAt,
        fulfillmentMode: order.fulfillmentMode,
        total: order.total,
        paymentStatus: order.paymentStatus,
        customerName: order.customer.name,
        customerPhone: order.customer.phone || null,
        customerAddress: order.customer.address || null,
        customerAddressLine1: order.customer.addressLine1 || null,
        customerAddressLine2: order.customer.addressLine2 || null,
        customerNeighborhood: order.customer.neighborhood || null,
        customerDeliveryNotes: order.customer.deliveryNotes || null,
        flavorSummary: this.notifications.buildDailyDigestFlavorSummary(order),
        whatsappUrl: this.notifications.buildDailyDigestWhatsAppLink(order)
      }))
    };
  }

  async sendForDate(dateKey: string, options?: { force?: boolean }): Promise<DailyDigestSendResult> {
    const force = options?.force === true;
    const runtime = this.getRuntimeConfig();
    if (!runtime.enabled) {
      return {
        ok: true,
        status: 'DISABLED',
        dateKey,
        orderCount: 0,
        sentAt: null
      };
    }

    if (!force) {
      const existing = await this.alreadySent(dateKey);
      if (existing) {
        let sentAt: string | null = existing.createdAt.toISOString();
        try {
          const parsed = JSON.parse(existing.responseJson || '{}') as { sentAt?: string };
          sentAt = parsed.sentAt || sentAt;
        } catch {}
        return {
          ok: true,
          status: 'ALREADY_SENT',
          dateKey,
          orderCount: 0,
          sentAt
        };
      }
    }

    const orders = await this.listOrdersForDate(dateKey);
    const notification = await this.notifications.notifyDailyOrderDigest({
      dateKey,
      orders
    });

    if (!notification.sent) {
      return {
        ok: true,
        status: 'DISABLED',
        dateKey,
        orderCount: orders.length,
        sentAt: null
      };
    }

    const sentAt = await this.storeSend(dateKey, orders.length);
    return {
      ok: true,
      status: 'SENT',
      dateKey,
      orderCount: orders.length,
      sentAt
    };
  }

  async maybeSendTodayDigest() {
    if (this.tickRunning) return;
    this.tickRunning = true;

    try {
      const runtime = this.getRuntimeConfig();
      if (!runtime.enabled) return;

      const now = this.getSaoPauloParts();
      if (now.hour < runtime.sendAtHour) return;
      await this.sendForDate(now.dateKey);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'order_daily_digest_failed',
          loggedAt: new Date().toISOString(),
          errorName: error instanceof Error ? error.name : 'NonErrorThrow',
          errorMessage: error instanceof Error ? error.message : String(error ?? 'Unhandled error')
        })
      );
    } finally {
      this.tickRunning = false;
    }
  }
}
