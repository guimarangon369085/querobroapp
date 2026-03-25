import { Injectable } from '@nestjs/common';
import { resolveDisplayNumber, type OrderIntakeMeta } from '@querobroapp/shared';

type OrderAlertOrder = {
  id: number;
  publicNumber?: number | null;
  fulfillmentMode: string;
  status: string;
  subtotal?: number | null;
  deliveryFee?: number | null;
  deliveryProvider?: string | null;
  total?: number | null;
  paymentStatus?: string | null;
  scheduledAt?: Date | string | null;
  notes?: string | null;
  items?: Array<{
    productId: number;
    quantity: number;
    name?: string | null;
  }>;
  customer: {
    id?: number | null;
    publicNumber?: number | null;
    name: string;
    phone?: string | null;
    address?: string | null;
    deliveryNotes?: string | null;
  };
};

type OrderAlertInput = {
  order: OrderAlertOrder;
  intake: OrderIntakeMeta;
};

type OrderAlertConfig = {
  ntfyTopicUrl: string;
  ntfyPriority: string;
  ntfyTags: string;
  webhookUrls: string[];
  webhookBearerToken: string;
  webhookTimeoutMs: number;
  operationsUrl: string;
};

@Injectable()
export class OrderNotificationsService {
  private readonly currencyFormatter = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

  private readonly dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });

  private getConfig(): OrderAlertConfig {
    const parseList = (value: string | undefined) =>
      String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

    const webhookTimeoutMs = Number.parseInt(String(process.env.ORDER_ALERT_WEBHOOK_TIMEOUT_MS || '7000'), 10);
    return {
      ntfyTopicUrl: String(process.env.ORDER_ALERT_NTFY_TOPIC_URL || '')
        .trim()
        .replace(/\/+$/, ''),
      ntfyPriority: String(process.env.ORDER_ALERT_NTFY_PRIORITY || '5').trim() || '5',
      ntfyTags: String(process.env.ORDER_ALERT_NTFY_TAGS || 'bread,shopping_cart').trim() || 'bread,shopping_cart',
      webhookUrls: Array.from(new Set(parseList(process.env.ORDER_ALERT_WEBHOOK_URL))),
      webhookBearerToken: String(process.env.ORDER_ALERT_WEBHOOK_BEARER_TOKEN || '').trim(),
      webhookTimeoutMs:
        Number.isFinite(webhookTimeoutMs) && webhookTimeoutMs >= 1000 && webhookTimeoutMs <= 30000
          ? webhookTimeoutMs
          : 7000,
      operationsUrl: String(process.env.ORDER_ALERT_OPERATIONS_URL || 'https://querobroa.com.br/pedidos')
        .trim()
        .replace(/\/+$/, '')
    };
  }

  private formatMoney(value?: number | null) {
    return this.currencyFormatter.format(Number(value || 0));
  }

  private formatScheduledAt(value?: Date | string | null) {
    if (!value) return 'Agora';
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Agora';
    return this.dateTimeFormatter.format(parsed);
  }

  private formatChannel(channel: OrderIntakeMeta['channel']) {
    switch (channel) {
      case 'CUSTOMER_LINK':
        return 'Site';
      case 'ADMIN_REPEAT':
        return 'Repeticao';
      case 'INTERNAL_DASHBOARD':
      default:
        return 'Operacao';
    }
  }

  private formatMode(mode: string) {
    return mode === 'PICKUP' ? 'Retirada' : 'Entrega';
  }

  private formatDeliveryLabel(order: OrderAlertOrder) {
    if (order.fulfillmentMode === 'PICKUP') return 'Frete: retirado no local';
    const provider = String(order.deliveryProvider || '').trim();
    if (!provider || provider === 'NONE') {
      return `Frete: ${this.formatMoney(order.deliveryFee)} (pendente)`;
    }

    return `Frete: ${this.formatMoney(order.deliveryFee)}`;
  }

  private compactProductName(value?: string | null) {
    const normalized = String(value || '')
      .replace(/^Broa\s+/i, '')
      .replace(/\s+\([^)]+\)\s*$/u, '')
      .trim();
    return normalized || 'Produto';
  }

  private buildFlavorSummary(order: OrderAlertOrder) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) return '';

    const byProduct = new Map<string, { label: string; quantity: number }>();
    for (const item of items) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;
      const key = String(item.productId || item.name || '').trim() || `${byProduct.size + 1}`;
      const current = byProduct.get(key) || {
        label: this.compactProductName(item.name),
        quantity: 0
      };
      current.quantity += quantity;
      byProduct.set(key, current);
    }

    return Array.from(byProduct.values())
      .map((entry) => `${entry.label} - ${entry.quantity.toLocaleString('pt-BR')}`)
      .join(' • ');
  }

  private buildAlertBody(input: OrderAlertInput, operationsUrl: string) {
    const { order, intake } = input;
    const orderNumber = resolveDisplayNumber(order) ?? order.id;
    const flavorSummary = this.buildFlavorSummary(order);
    const lines = [
      `Novo pedido #${orderNumber}`,
      `${this.formatChannel(intake.channel)} | ${this.formatMode(order.fulfillmentMode)}`,
      `Cliente: ${order.customer.name.trim()}`,
      flavorSummary ? `Sabores: ${flavorSummary}` : null,
      order.customer.phone ? `Telefone: ${order.customer.phone}` : null,
      `Agendamento: ${this.formatScheduledAt(order.scheduledAt)}`,
      order.fulfillmentMode === 'DELIVERY'
        ? `Destino: ${order.customer.address?.trim() || 'Endereco nao informado'}`
        : 'Retirada: Alameda Jau, 731',
      this.formatDeliveryLabel(order),
      `Total: ${this.formatMoney(order.total)}`,
      `PIX: ${intake.pixStatus === 'PAGO' ? 'pago' : 'pendente'}`,
      order.notes?.trim() ? `Obs pedido: ${order.notes.trim()}` : null,
      order.customer.deliveryNotes?.trim() ? `Obs entrega: ${order.customer.deliveryNotes.trim()}` : null,
      '',
      `Abrir operacao: ${operationsUrl}`
    ];

    return lines.filter(Boolean).join('\n');
  }

  private buildWebhookPayload(input: OrderAlertInput, operationsUrl: string, message: string) {
    const { order, intake } = input;
    const flavorSummary = this.buildFlavorSummary(order);
    return {
      event: 'order.created',
      createdAt: new Date().toISOString(),
      message,
      operationsUrl,
      order: {
        id: order.id,
        publicNumber: resolveDisplayNumber(order),
        status: order.status,
        fulfillmentMode: order.fulfillmentMode,
        scheduledAt:
          order.scheduledAt instanceof Date
            ? order.scheduledAt.toISOString()
            : typeof order.scheduledAt === 'string'
              ? order.scheduledAt
              : null,
        subtotal: Number(order.subtotal || 0),
        deliveryFee: Number(order.deliveryFee || 0),
        deliveryProvider: String(order.deliveryProvider || 'NONE'),
        total: Number(order.total || 0),
        paymentStatus: String(order.paymentStatus || 'PENDENTE'),
        flavorSummary: flavorSummary || null,
        items: (order.items || []).map((item) => ({
          productId: item.productId,
          name: item.name || null,
          quantity: Math.max(Math.floor(item.quantity || 0), 0)
        }))
      },
      customer: {
        id: Number(order.customer.id || intake.customerId || 0) || null,
        publicNumber: resolveDisplayNumber(order.customer),
        name: order.customer.name,
        phone: order.customer.phone || null,
        address: order.customer.address || null,
        deliveryNotes: order.customer.deliveryNotes || null
      },
      intake: {
        channel: intake.channel,
        intent: intake.intent,
        stage: intake.stage,
        pixStatus: intake.pixStatus,
        orderId: intake.orderId,
        customerId: intake.customerId
      }
    };
  }

  private logFailure(channel: 'NTFY' | 'WEBHOOK', error: unknown, context: Record<string, unknown>) {
    const detail =
      error instanceof Error
        ? {
            errorName: error.name || 'Error',
            errorMessage: error.message || 'Unhandled error'
          }
        : {
            errorName: 'NonErrorThrow',
            errorMessage: String(error ?? 'Unhandled error')
          };

    console.error(
      JSON.stringify({
        event: 'order_alert_failed',
        channel,
        loggedAt: new Date().toISOString(),
        ...context,
        ...detail
      })
    );
  }

  private async postWebhook(url: string, payload: unknown, config: OrderAlertConfig) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.webhookTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.webhookBearerToken ? { authorization: `Bearer ${config.webhookBearerToken}` } : {})
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(body.trim() || `HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async postNtfy(title: string, message: string, config: OrderAlertConfig) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.webhookTimeoutMs);

    try {
      const response = await fetch(config.ntfyTopicUrl, {
        method: 'POST',
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          title,
          priority: config.ntfyPriority,
          tags: config.ntfyTags,
          click: config.operationsUrl
        },
        body: message,
        signal: controller.signal
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(body.trim() || `HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async notifyNewOrder(input: OrderAlertInput) {
    const config = this.getConfig();
    if (!config.ntfyTopicUrl && config.webhookUrls.length === 0) {
      return;
    }

    const message = this.buildAlertBody(input, config.operationsUrl);
    const webhookPayload = this.buildWebhookPayload(input, config.operationsUrl, message);
    const tasks: Array<Promise<unknown>> = [];
    const title = `Novo pedido #${resolveDisplayNumber(input.order) ?? input.order.id}`;

    if (config.ntfyTopicUrl) {
      tasks.push(
        this.postNtfy(title, message, config).catch((error) => {
          this.logFailure('NTFY', error, { orderId: input.order.id, topicUrl: config.ntfyTopicUrl });
        })
      );
    }

    for (const url of config.webhookUrls) {
      tasks.push(
        this.postWebhook(url, webhookPayload, config).catch((error) => {
          this.logFailure('WEBHOOK', error, { orderId: input.order.id, url });
        })
      );
    }

    await Promise.all(tasks);
  }
}
