import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service.js';

type OrderWithDeliveryContext = Awaited<ReturnType<DeliveriesService['getOrderForDelivery']>>;

type DeliveryDraft = {
  orderId: number;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  orderTotal: number;
  scheduledAt: string;
  manifestSummary: string;
  items: Array<{
    productId: number;
    name: string;
    quantity: number;
  }>;
};

type DeliveryReadinessResult = {
  provider: 'LOCAL';
  mode: 'INTERNAL';
  ready: boolean;
  reason: string;
  missingRequirements: string[];
  draft: DeliveryDraft;
};

type DeliveryTrackingStatus =
  | 'PENDING_REQUIREMENTS'
  | 'REQUESTED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED';

type DeliveryTrackingRecord = {
  orderId: number;
  provider: 'LOCAL';
  mode: 'INTERNAL';
  status: DeliveryTrackingStatus;
  createdAt: string;
  updatedAt: string;
  trackingId: string;
  pickupEta: string | null;
  dropoffEta: string | null;
  lastError: string | null;
  draft: DeliveryDraft;
};

type LegacyDeliveryTrackingRecord = Partial<DeliveryTrackingRecord> & {
  provider?: string;
  mode?: string;
  status?: string;
  providerDeliveryId?: string | null;
  providerOrderId?: string | null;
  providerQuoteId?: string | null;
  trackingUrl?: string | null;
  lastProviderError?: string | null;
};

@Injectable()
export class DeliveriesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getReadiness(orderId: number): Promise<DeliveryReadinessResult> {
    const order = await this.getOrderForDelivery(orderId);
    const dropoffAddress = this.buildCustomerAddress(order.customer);
    const items = (order.items || []).map((item) => ({
      productId: item.productId,
      name: item.product?.name || `Produto ${item.productId}`,
      quantity: item.quantity
    }));

    const missingRequirements = [
      ...(!order.customer?.name?.trim() ? ['cliente sem nome'] : []),
      ...(!order.customer?.phone?.trim() ? ['cliente sem telefone'] : []),
      ...(!dropoffAddress ? ['cliente sem endereco completo para entrega'] : []),
      ...((order.items || []).length === 0 ? ['pedido sem itens'] : [])
    ];

    const ready = missingRequirements.length === 0;
    return {
      provider: 'LOCAL',
      mode: 'INTERNAL',
      ready,
      reason: ready
        ? 'Entrega local pronta para iniciar.'
        : `Corrija os dados do pedido antes de iniciar: ${missingRequirements.join(' • ')}`,
      missingRequirements,
      draft: {
        orderId: order.id,
        customerName: (order.customer?.name || '').trim(),
        customerPhone: (order.customer?.phone || '').trim(),
        dropoffAddress,
        orderTotal: this.toMoney(order.total ?? 0),
        scheduledAt: order.scheduledAt?.toISOString() || '',
        manifestSummary: items.map((item) => `${item.name} x ${item.quantity}`).join(', '),
        items
      }
    };
  }

  async startOrderDelivery(orderId: number) {
    const order = await this.getOrderForDelivery(orderId);
    if (!['PRONTO', 'ENTREGUE'].includes(order.status)) {
      throw new BadRequestException('Entrega so pode ser iniciada quando o pedido estiver PRONTO.');
    }

    const readiness = await this.getReadiness(orderId);
    const existing = await this.readTracking(orderId);
    if (existing && existing.status !== 'FAILED' && existing.status !== 'DELIVERED') {
      return {
        reusedExisting: true,
        tracking: await this.syncTrackingRecord(existing)
      };
    }

    if (!readiness.ready) {
      const blocked = await this.saveTracking(orderId, {
        orderId,
        provider: 'LOCAL',
        mode: 'INTERNAL',
        status: 'PENDING_REQUIREMENTS',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trackingId: `blocked-${randomUUID()}`,
        pickupEta: null,
        dropoffEta: null,
        lastError: readiness.missingRequirements.join(' • '),
        draft: readiness.draft
      });

      return {
        reusedExisting: false,
        tracking: blocked
      };
    }

    const tracking = await this.createLocalTracking(orderId, readiness);
    return {
      reusedExisting: false,
      tracking
    };
  }

  async getOrderTracking(orderId: number) {
    await this.getOrderForDelivery(orderId);
    const tracking = await this.readTracking(orderId);
    if (!tracking) {
      return {
        exists: false,
        tracking: null
      };
    }

    return {
      exists: true,
      tracking: await this.syncTrackingRecord(tracking)
    };
  }

  async markTrackingAsDelivered(orderId: number) {
    await this.getOrderForDelivery(orderId);
    const tracking = await this.readTracking(orderId);
    if (!tracking) {
      throw new NotFoundException('Entrega ainda nao foi iniciada para este pedido.');
    }

    const delivered = await this.persistSyncedTracking({
      ...tracking,
      status: 'DELIVERED',
      updatedAt: new Date().toISOString()
    });
    await this.markOrderDeliveredIfNeeded(orderId);
    return delivered;
  }

  private async getOrderForDelivery(orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });

    if (!order) {
      throw new NotFoundException('Pedido nao encontrado.');
    }

    return order;
  }

  private toMoney(value: number) {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private buildCustomerAddress(customer?: OrderWithDeliveryContext['customer'] | null) {
    if (!customer) return '';

    const normalizedFallback = (customer.address || '').trim();
    const cityState = [customer.city, customer.state].filter(Boolean).join(' - ');
    const parts = [
      customer.addressLine1,
      customer.addressLine2,
      customer.neighborhood,
      cityState,
      customer.postalCode,
      customer.country
    ]
      .map((part) => (part || '').trim())
      .filter(Boolean);

    return parts.length > 0 ? parts.join(', ') : normalizedFallback;
  }

  private async createLocalTracking(orderId: number, readiness: DeliveryReadinessResult) {
    const now = Date.now();
    return this.saveTracking(orderId, {
      orderId,
      provider: 'LOCAL',
      mode: 'INTERNAL',
      status: 'REQUESTED',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      trackingId: `local-${randomUUID()}`,
      pickupEta: new Date(now + 10 * 60_000).toISOString(),
      dropoffEta: new Date(now + 40 * 60_000).toISOString(),
      lastError: null,
      draft: readiness.draft
    });
  }

  private async syncTrackingRecord(tracking: DeliveryTrackingRecord) {
    const now = Date.now();
    const pickupAt = tracking.pickupEta ? new Date(tracking.pickupEta).getTime() : NaN;
    const dropoffAt = tracking.dropoffEta ? new Date(tracking.dropoffEta).getTime() : NaN;

    if (tracking.status !== 'DELIVERED' && Number.isFinite(dropoffAt) && now >= dropoffAt) {
      const delivered = await this.persistSyncedTracking({
        ...tracking,
        status: 'DELIVERED',
        updatedAt: new Date().toISOString()
      });
      await this.markOrderDeliveredIfNeeded(delivered.orderId);
      return delivered;
    }

    if (tracking.status === 'REQUESTED' && Number.isFinite(pickupAt) && now >= pickupAt) {
      return this.persistSyncedTracking({
        ...tracking,
        status: 'OUT_FOR_DELIVERY',
        updatedAt: new Date().toISOString()
      });
    }

    return tracking;
  }

  private async markOrderDeliveredIfNeeded(orderId: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status === 'ENTREGUE' || order.status === 'CANCELADO') {
      return;
    }

    if (order.status !== 'PRONTO') {
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'ENTREGUE' }
    });
  }

  private async readTracking(orderId: number): Promise<DeliveryTrackingRecord | null> {
    const record = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: 'DELIVERY_TRACKING',
          idemKey: `ORDER_${orderId}`
        }
      }
    });
    if (!record) return null;

    try {
      return this.normalizeTrackingRecord(
        orderId,
        JSON.parse(record.responseJson) as LegacyDeliveryTrackingRecord
      );
    } catch {
      return null;
    }
  }

  private normalizeTrackingRecord(
    orderId: number,
    tracking: LegacyDeliveryTrackingRecord
  ): DeliveryTrackingRecord {
    const createdAt = this.normalizeIsoTimestamp(tracking.createdAt) || new Date().toISOString();
    const updatedAt = this.normalizeIsoTimestamp(tracking.updatedAt) || createdAt;
    const trackingId =
      this.normalizeText(tracking.trackingId) ||
      this.normalizeText(tracking.providerDeliveryId) ||
      this.normalizeText(tracking.providerOrderId) ||
      `legacy-order-${orderId}`;

    return {
      orderId,
      provider: 'LOCAL',
      mode: 'INTERNAL',
      status: this.normalizeTrackingStatus(tracking.status),
      createdAt,
      updatedAt,
      trackingId,
      pickupEta: this.normalizeIsoTimestamp(tracking.pickupEta),
      dropoffEta: this.normalizeIsoTimestamp(tracking.dropoffEta),
      lastError:
        this.normalizeText(tracking.lastError) || this.normalizeText(tracking.lastProviderError) || null,
      draft: this.normalizeDraft(orderId, tracking.draft)
    };
  }

  private normalizeTrackingStatus(status: string | undefined): DeliveryTrackingStatus {
    if (
      status === 'PENDING_REQUIREMENTS' ||
      status === 'REQUESTED' ||
      status === 'OUT_FOR_DELIVERY' ||
      status === 'DELIVERED' ||
      status === 'FAILED'
    ) {
      return status;
    }
    return 'REQUESTED';
  }

  private normalizeDraft(orderId: number, draft?: Partial<DeliveryDraft>): DeliveryDraft {
    return {
      orderId,
      customerName: this.normalizeText(draft?.customerName) || '',
      customerPhone: this.normalizeText(draft?.customerPhone) || '',
      dropoffAddress: this.normalizeText(draft?.dropoffAddress) || '',
      orderTotal: this.toMoney(draft?.orderTotal ?? 0),
      scheduledAt: this.normalizeText(draft?.scheduledAt) || '',
      manifestSummary: this.normalizeText(draft?.manifestSummary) || '',
      items: Array.isArray(draft?.items)
        ? draft.items
            .map((item) => ({
              productId: Number(item?.productId) || 0,
              name: this.normalizeText(item?.name) || '',
              quantity: Math.max(Number(item?.quantity) || 0, 0)
            }))
            .filter((item) => item.productId > 0 || item.name || item.quantity > 0)
        : []
    };
  }

  private normalizeIsoTimestamp(value: string | null | undefined) {
    const normalized = this.normalizeText(value);
    if (!normalized) return null;

    const timestamp = Date.parse(normalized);
    if (Number.isNaN(timestamp)) {
      return null;
    }

    return new Date(timestamp).toISOString();
  }

  private normalizeText(value: string | null | undefined) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || '';
  }

  private async saveTracking(orderId: number, tracking: DeliveryTrackingRecord | LegacyDeliveryTrackingRecord) {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    const normalized = this.normalizeTrackingRecord(orderId, tracking);

    await this.prisma.idempotencyRecord.upsert({
      where: {
        scope_idemKey: {
          scope: 'DELIVERY_TRACKING',
          idemKey: `ORDER_${orderId}`
        }
      },
      update: {
        requestHash: normalized.trackingId,
        responseJson: JSON.stringify(normalized),
        expiresAt
      },
      create: {
        scope: 'DELIVERY_TRACKING',
        idemKey: `ORDER_${orderId}`,
        requestHash: normalized.trackingId,
        responseJson: JSON.stringify(normalized),
        expiresAt
      }
    });

    return normalized;
  }

  private async persistSyncedTracking(tracking: DeliveryTrackingRecord) {
    return this.saveTracking(tracking.orderId, tracking);
  }
}
