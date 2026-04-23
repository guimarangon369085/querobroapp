import { Injectable } from '@nestjs/common';
import { normalizePhone, normalizeText, normalizeTitle } from '../../common/normalize.js';
import { EXTERNAL_ORDER_DELIVERY_WINDOWS, resolveExternalOrderDeliveryWindowKeyForDate } from '../../common/external-order-schedule.js';
import {
  buildCompanionProductMakerLine,
  normalizeOrderStatus,
  parseOrderItemsSummaryFromNotes,
  parseCompanionProductProfileFromName,
  resolveDisplayNumber,
  type OrderIntakeMeta
} from '@querobroapp/shared';
import { resolveOfficialBroaFlavorCodeFromProductName } from '../inventory/inventory-formulas.js';

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
  customerSnapshot?: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    deliveryNotes?: string | null;
  } | null;
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

export type DailyDigestOrder = {
  id: number;
  publicNumber?: number | null;
  status?: string | null;
  fulfillmentMode: string;
  total?: number | null;
  deliveryFee?: number | null;
  scheduledAt?: Date | string | null;
  createdAt?: Date | string | null;
  notes?: string | null;
  paymentStatus?: string | null;
  customer: {
    name: string;
    phone?: string | null;
    address?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    neighborhood?: string | null;
    deliveryNotes?: string | null;
  };
  items?: Array<{
    productId: number;
    quantity: number;
    name?: string | null;
  }>;
};

type DailyOrderDigestInput = {
  dateKey: string;
  orders: DailyDigestOrder[];
};

type OrderAlertConfig = {
  enabled?: boolean;
  ntfyTopicUrl: string;
  ntfyPriority: string;
  ntfyTags: string;
  webhookUrls: string[];
  webhookBearerToken: string;
  webhookTimeoutMs: number;
  operationsUrl: string;
};

type WhatsAppCloudSendMode = 'TEXT' | 'TEMPLATE';

type WhatsAppCloudConfig = {
  enabled: boolean;
  token: string;
  phoneNumberId: string;
  version: string;
  baseUrl: string;
  timeoutMs: number;
  mode: WhatsAppCloudSendMode;
  templateName: string;
  templateLanguage: string;
};

type CustomerConfirmationOrder = {
  fulfillmentMode: string;
  scheduledAt?: Date | string | null;
  total?: number | null;
  notes?: string | null;
  customer: {
    name: string;
    phone?: string | null;
    address?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    neighborhood?: string | null;
    deliveryNotes?: string | null;
  };
  items?: Array<{
    productId: number;
    quantity: number;
    name?: string | null;
  }>;
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

  private readonly shortDateFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit'
  });

  private readonly timeFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit'
  });

  private envValue(primaryKey: string, fallbackKey?: string, defaultValue = '') {
    const primary = String(process.env[primaryKey] || '').trim();
    if (primary) return primary;
    if (fallbackKey) {
      const fallback = String(process.env[fallbackKey] || '').trim();
      if (fallback) return fallback;
    }
    return defaultValue;
  }

  private envFlag(primaryKey: string, fallbackKey?: string, defaultValue = true) {
    const raw = this.envValue(primaryKey, fallbackKey, defaultValue ? 'true' : 'false').toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(raw)) return false;
    if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
    return defaultValue;
  }

  private parseList(value: string | undefined) {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private getConfig(): OrderAlertConfig {
    const webhookTimeoutMs = Number.parseInt(String(process.env.ORDER_ALERT_WEBHOOK_TIMEOUT_MS || '7000'), 10);
    return {
      ntfyTopicUrl: String(process.env.ORDER_ALERT_NTFY_TOPIC_URL || '')
        .trim()
        .replace(/\/+$/, ''),
      ntfyPriority: String(process.env.ORDER_ALERT_NTFY_PRIORITY || '5').trim() || '5',
      ntfyTags: String(process.env.ORDER_ALERT_NTFY_TAGS || 'bread,shopping_cart').trim() || 'bread,shopping_cart',
      webhookUrls: Array.from(new Set(this.parseList(process.env.ORDER_ALERT_WEBHOOK_URL))),
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

  private getDailyDigestConfig(): OrderAlertConfig {
    const explicitEnabledRaw = String(process.env.ORDER_DAILY_DIGEST_ENABLED || '').trim().toLowerCase();
    const explicitTopic = String(process.env.ORDER_DAILY_DIGEST_NTFY_TOPIC_URL || '').trim();
    const enabled =
      explicitEnabledRaw !== ''
        ? !['0', 'false', 'off', 'no'].includes(explicitEnabledRaw)
        : Boolean(explicitTopic);
    const webhookTimeoutMs = Number.parseInt(
      this.envValue('ORDER_DAILY_DIGEST_WEBHOOK_TIMEOUT_MS', 'ORDER_ALERT_WEBHOOK_TIMEOUT_MS', '7000'),
      10
    );
    return {
      enabled,
      ntfyTopicUrl: enabled
        ? this.envValue('ORDER_DAILY_DIGEST_NTFY_TOPIC_URL', 'ORDER_ALERT_NTFY_TOPIC_URL').replace(/\/+$/, '')
        : '',
      ntfyPriority: this.envValue('ORDER_DAILY_DIGEST_NTFY_PRIORITY', 'ORDER_ALERT_NTFY_PRIORITY', '4'),
      ntfyTags: this.envValue('ORDER_DAILY_DIGEST_NTFY_TAGS', undefined, 'sunrise,bread,clipboard'),
      webhookUrls: [],
      webhookBearerToken: '',
      webhookTimeoutMs:
        Number.isFinite(webhookTimeoutMs) && webhookTimeoutMs >= 1000 && webhookTimeoutMs <= 30000
          ? webhookTimeoutMs
          : 7000,
      operationsUrl: this.envValue(
        'ORDER_DAILY_DIGEST_OPERATIONS_URL',
        'ORDER_ALERT_OPERATIONS_URL',
        'https://querobroa.com.br/confirmacoes'
      ).replace(/\/+$/, '')
    };
  }

  private getWhatsAppCloudConfig(): WhatsAppCloudConfig {
    const timeoutMs = Number.parseInt(String(process.env.WHATSAPP_CLOUD_TIMEOUT_MS || '15000'), 10);
    const token = this.envValue('WHATSAPP_CLOUD_ACCESS_TOKEN', 'WHATSAPP_CLOUD_API_TOKEN');
    const phoneNumberId = this.envValue('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
    const templateName = this.envValue('WHATSAPP_CLOUD_ORDER_CONFIRMATION_TEMPLATE_NAME');
    return {
      enabled:
        this.envFlag('WHATSAPP_CLOUD_ORDER_CONFIRMATION_AUTO_SEND_ENABLED', undefined, false) &&
        Boolean(token && phoneNumberId),
      token,
      phoneNumberId,
      version: this.envValue('WHATSAPP_CLOUD_API_VERSION', undefined, 'v23.0'),
      baseUrl: this.envValue('WHATSAPP_CLOUD_API_BASE_URL', undefined, 'https://graph.facebook.com').replace(/\/+$/, ''),
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000 ? timeoutMs : 15000,
      mode: templateName ? 'TEMPLATE' : 'TEXT',
      templateName,
      templateLanguage: this.envValue('WHATSAPP_CLOUD_ORDER_CONFIRMATION_TEMPLATE_LANGUAGE', undefined, 'pt_BR')
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

  private formatTime(value?: Date | string | null) {
    if (!value) return 'Sem horario';
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Sem horario';
    return this.timeFormatter.format(parsed);
  }

  private formatShortDate(value: Date | string) {
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return this.shortDateFormatter.format(parsed);
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

  private compactCustomerName(value?: string | null) {
    const parts = String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return parts[0] || 'Cliente';
  }

  private firstName(value?: string | null) {
    return this.compactCustomerName(value);
  }

  private normalizeRecipientPhone(value?: string | null) {
    const normalized = normalizePhone(value);
    if (!normalized) return null;
    if (normalized.startsWith('55')) return normalized;
    if (normalized.length === 10 || normalized.length === 11) return `55${normalized}`;
    return normalized;
  }

  private resolveOrderCustomerIdentity(order: OrderAlertOrder) {
    return {
      name: order.customerSnapshot?.name || order.customer.name,
      phone: order.customerSnapshot?.phone || order.customer.phone || null,
      address: order.customerSnapshot?.address || order.customer.address || null,
      deliveryNotes: order.customerSnapshot?.deliveryNotes || order.customer.deliveryNotes || null
    };
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

  private compactDailyDigestProductLabel(value?: string | null) {
    const companionProfile = parseCompanionProductProfileFromName(value);
    if (companionProfile?.title) {
      return companionProfile.title;
    }
    return this.compactProductName(value);
  }

  private normalizeCustomerConfirmationEntryLabel(entry: { label: string; detail: string | null }) {
    const rawLabel = String(entry.label || '').trim();
    if (!rawLabel) {
      return {
        label: '',
        detail: entry.detail
      };
    }

    const quantitySuffixMatch = rawLabel.match(/\s+(\((?:\d+)\s+(?:item|itens)\))$/i);
    const quantitySuffix = quantitySuffixMatch?.[1] || '';
    const labelWithoutQuantity =
      quantitySuffix && quantitySuffixMatch
        ? rawLabel.slice(0, -quantitySuffixMatch[0].length).trim()
        : rawLabel;
    const companionProfile = parseCompanionProductProfileFromName(labelWithoutQuantity);
    if (!companionProfile?.title) {
      return {
        label: rawLabel,
        detail: entry.detail
      };
    }

    const makerLine = buildCompanionProductMakerLine(companionProfile);
    const derivedDetail = [companionProfile.flavor, makerLine].filter(Boolean).join(' • ') || null;
    return {
      label: [companionProfile.title, quantitySuffix].filter(Boolean).join(' ').trim(),
      detail: entry.detail || derivedDetail
    };
  }

  private resolveDailyDigestFlavorCode(value?: string | null) {
    const officialCode = resolveOfficialBroaFlavorCodeFromProductName(value);
    if (officialCode) return officialCode;
    const normalized = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    if (normalized.includes('pascoa')) return 'P';
    return null;
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

  private buildDailyDigestFlavorCodeSummary(order: Pick<CustomerConfirmationOrder, 'items'>) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) return '';

    const byKey = new Map<string, { label: string; quantity: number }>();
    for (const item of items) {
      const quantity = Math.max(Math.floor(item.quantity || 0), 0);
      if (quantity <= 0) continue;

      const flavorCode = this.resolveDailyDigestFlavorCode(item.name);
      const label = flavorCode || this.compactDailyDigestProductLabel(item.name);
      const key = flavorCode || String(item.productId || item.name || '').trim() || `${byKey.size + 1}`;
      const current = byKey.get(key) || { label, quantity: 0 };
      current.quantity += quantity;
      byKey.set(key, current);
    }

    return Array.from(byKey.values())
      .map((entry) => `${entry.quantity.toLocaleString('pt-BR')}${entry.label}`)
      .join(' • ');
  }

  private buildDailyDigestScheduleLabel(value?: Date | string | null) {
    if (!value) return 'hoje';
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'hoje';

    const dateLabel = this.formatShortDate(parsed);
    const windowKey = resolveExternalOrderDeliveryWindowKeyForDate(parsed);
    const deliveryWindow = windowKey ? EXTERNAL_ORDER_DELIVERY_WINDOWS.find((entry) => entry.key === windowKey) : null;
    if (deliveryWindow) {
      const startLabel = `${String(deliveryWindow.startHour).padStart(2, '0')}:${String(deliveryWindow.startMinute).padStart(2, '0')}`;
      const endLabel = `${String(deliveryWindow.endHour).padStart(2, '0')}:${String(deliveryWindow.endMinute).padStart(2, '0')}`;
      return `${dateLabel}, entre ${startLabel} e ${endLabel}`;
    }

    return `${dateLabel}, às ${this.formatTime(parsed)}`;
  }

  private buildDailyDigestCustomerAddress(order: Pick<CustomerConfirmationOrder, 'fulfillmentMode' | 'customer'>) {
    if (order.fulfillmentMode === 'PICKUP') {
      return 'Retirada no local';
    }

    const addressLine1 = normalizeTitle(order.customer.addressLine1 ?? undefined);
    const neighborhood = normalizeTitle(order.customer.neighborhood ?? undefined);
    const addressLine2 = normalizeTitle(order.customer.addressLine2 ?? undefined);
    const rawAddress = normalizeTitle(order.customer.address ?? undefined);
    const deliveryNotesRaw = normalizeText(order.customer.deliveryNotes ?? undefined);
    const deliveryNotes =
      deliveryNotesRaw && deliveryNotesRaw.startsWith('[') && deliveryNotesRaw.endsWith(']') ? null : deliveryNotesRaw;
    const visibleAddress = [addressLine1, neighborhood, addressLine2].filter(Boolean).join(', ');

    if (visibleAddress && deliveryNotes) {
      const sameComplement =
        addressLine2 && addressLine2.localeCompare(deliveryNotes, 'pt-BR', { sensitivity: 'accent' }) === 0;
      return sameComplement ? visibleAddress : `${visibleAddress} • Obs: ${deliveryNotes}`;
    }

    if (visibleAddress) return visibleAddress;
    if (deliveryNotes) return `Obs: ${deliveryNotes}`;
    return rawAddress || 'Endereço não informado';
  }

  private buildCustomerConfirmationText(order: CustomerConfirmationOrder) {
    const scheduleLabel = this.buildDailyDigestScheduleLabel(order.scheduledAt);
    const modeLabel = this.formatMode(order.fulfillmentMode);
    const addressLabel = this.buildDailyDigestCustomerAddress(order);
    const lines = [
      `Oi, ${this.firstName(order.customer.name)}!`,
      `Passando para confirmar seu pedido da @QUEROBROA para ${scheduleLabel}.`,
      `Modalidade: ${modeLabel}`,
      `Endereço: ${addressLabel}`,
      ...this.buildDailyDigestOrderMessageLines(order),
      `Total: ${this.formatMoney(order.total)}`,
      'Se estiver tudo certo, me responde com OK por aqui. Se precisar ajustar algo, me avisa nesta mensagem mesmo que a gente resolve!'
    ];
    return lines.filter(Boolean).join('\n');
  }

  private buildCustomerConfirmationTemplateParameters(order: CustomerConfirmationOrder) {
    const orderLines = this.buildDailyDigestOrderMessageLines(order);
    const orderBlock = orderLines.length > 0 ? orderLines.join('\n') : 'Pedido: sem itens detalhados';
    return [
      this.firstName(order.customer.name),
      this.buildDailyDigestScheduleLabel(order.scheduledAt),
      this.formatMode(order.fulfillmentMode),
      this.buildDailyDigestCustomerAddress(order),
      orderBlock,
      this.formatMoney(order.total)
    ].map((text) => ({
      type: 'text' as const,
      text
    }));
  }

  private buildDailyDigestOrderMessageLines(order: Pick<CustomerConfirmationOrder, 'notes' | 'items'>) {
    const detailedEntries = parseOrderItemsSummaryFromNotes(order.notes).map((entry) =>
      this.normalizeCustomerConfirmationEntryLabel(entry)
    );
    if (detailedEntries.length > 0) {
      return [
        'Pedido:',
        ...detailedEntries.flatMap((entry, index) => [
          `#${index + 1}`,
          entry.label,
          ...(entry.detail ? [entry.detail] : [])
        ])
      ];
    }

    const flavorSummary = this.buildDailyDigestFlavorCodeSummary(order);
    return flavorSummary ? [`Pedido: ${flavorSummary}`] : [];
  }

  private buildAlertBody(input: OrderAlertInput, operationsUrl: string) {
    const { order, intake } = input;
    const orderNumber = resolveDisplayNumber(order) ?? order.id;
    const flavorSummary = this.buildFlavorSummary(order);
    const customer = this.resolveOrderCustomerIdentity(order);
    const customerFullName = normalizeTitle(customer.name ?? undefined) || this.compactCustomerName(customer.name);
    const lines = [
      `Novo pedido #${orderNumber}`,
      `${this.formatChannel(intake.channel)} | ${this.formatMode(order.fulfillmentMode)}`,
      `Cliente: ${customerFullName}`,
      flavorSummary ? `Sabores: ${flavorSummary}` : null,
      `Agendamento: ${this.formatScheduledAt(order.scheduledAt)}`,
      order.fulfillmentMode === 'DELIVERY' ? 'Modo: entrega' : 'Modo: retirada',
      this.formatDeliveryLabel(order),
      `Total: ${this.formatMoney(order.total)}`,
      `PIX: ${intake.pixStatus === 'PAGO' ? 'pago' : 'pendente'}`,
      '',
      `Abrir operação: ${operationsUrl}`
    ];

    return lines.filter(Boolean).join('\n');
  }

  private buildWebhookPayload(input: OrderAlertInput, operationsUrl: string, message: string) {
    const { order, intake } = input;
    const flavorSummary = this.buildFlavorSummary(order);
    const customer = this.resolveOrderCustomerIdentity(order);
    return {
      event: 'order.created',
      createdAt: new Date().toISOString(),
      message,
      operationsUrl,
      order: {
        id: order.id,
        publicNumber: resolveDisplayNumber(order),
        status: normalizeOrderStatus(order.status) || 'ABERTO',
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
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        deliveryNotes: customer.deliveryNotes
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

  buildDailyDigestWhatsAppLink(order: DailyDigestOrder) {
    const normalized = this.normalizeRecipientPhone(order.customer.phone);
    if (!normalized) return null;
    const message = this.buildCustomerConfirmationText(order);
    return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  }

  buildDailyDigestFlavorSummary(order: DailyDigestOrder) {
    return this.buildDailyDigestFlavorCodeSummary(order);
  }

  private buildDigestClickUrl(operationsUrl: string, dateKey: string) {
    try {
      const url = new URL(operationsUrl);
      url.searchParams.set('date', dateKey);
      return url.toString();
    } catch {
      return operationsUrl;
    }
  }

  private buildDailyDigestBody(input: DailyOrderDigestInput, operationsUrl: string) {
    const total = input.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const deliveryCount = input.orders.filter((order) => order.fulfillmentMode !== 'PICKUP').length;
    const pickupCount = input.orders.length - deliveryCount;
    const lines = [
      `Resumo do dia ${this.formatShortDate(`${input.dateKey}T12:00:00-03:00`)}`,
      `${input.orders.length} pedido(s) • ${deliveryCount} entrega(s) • ${pickupCount} retirada(s) • ${this.formatMoney(total)}`,
      'Toque para abrir a fila de confirmação.',
      ''
    ];

    if (input.orders.length === 0) {
      lines.push('Nenhum pedido programado para hoje.');
      lines.push('');
      lines.push(`Abrir operação: ${operationsUrl}`);
      return lines.join('\n');
    }

    input.orders.forEach((order, index) => {
      const orderNumber = resolveDisplayNumber(order) ?? order.id;
      const flavors = this.buildDailyDigestFlavorSummary(order);
      const paidLabel = String(order.paymentStatus || '').toUpperCase() === 'PAGO' ? 'PAGO' : 'PENDENTE';
      lines.push(
        `${index + 1}. ${this.formatTime(order.scheduledAt)} • #${orderNumber} • ${order.customer.name} • ${this.formatMode(order.fulfillmentMode)} • ${this.formatMoney(order.total)} • PIX ${paidLabel}`
      );
      if (flavors) {
        lines.push(`Sabores: ${flavors}`);
      }
      lines.push(`WhatsApp: ${order.customer.phone || 'sem numero'}`);
      lines.push('');
    });

    lines.push(`Fila: ${this.buildDigestClickUrl(operationsUrl, input.dateKey)}`);
    return lines.join('\n');
  }

  private logFailure(channel: 'NTFY' | 'WEBHOOK' | 'WHATSAPP', error: unknown, context: Record<string, unknown>) {
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

  private async postWhatsAppTextMessage(to: string, body: string, config: WhatsAppCloudConfig) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const url = `${config.baseUrl}/${config.version}/${config.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: false,
            body
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(bodyText.trim() || `HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async postWhatsAppTemplateMessage(to: string, order: CustomerConfirmationOrder, config: WhatsAppCloudConfig) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const url = `${config.baseUrl}/${config.version}/${config.phoneNumberId}/messages`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: config.templateName,
            language: {
              code: config.templateLanguage
            },
            components: [
              {
                type: 'body',
                parameters: this.buildCustomerConfirmationTemplateParameters(order)
              }
            ]
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new Error(bodyText.trim() || `HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldAutoSendWhatsAppConfirmation(input: OrderAlertInput, config: WhatsAppCloudConfig) {
    if (!config.enabled) return false;
    if (input.intake.channel !== 'CUSTOMER_LINK') return false;
    return Boolean(this.normalizeRecipientPhone(this.resolveOrderCustomerIdentity(input.order).phone));
  }

  private async sendCustomerOrderConfirmation(input: OrderAlertInput, config: WhatsAppCloudConfig) {
    const customer = this.resolveOrderCustomerIdentity(input.order);
    const to = this.normalizeRecipientPhone(customer.phone);
    if (!to) return;

    const order: CustomerConfirmationOrder = {
      fulfillmentMode: input.order.fulfillmentMode,
      scheduledAt: input.order.scheduledAt,
      total: input.order.total,
      notes: input.order.notes,
      customer: {
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        deliveryNotes: customer.deliveryNotes
      },
      items: (input.order.items || []).map((item) => ({
        productId: item.productId,
        quantity: Math.max(Math.floor(item.quantity || 0), 0),
        name: item.name || null
      }))
    };

    if (config.mode === 'TEMPLATE') {
      await this.postWhatsAppTemplateMessage(to, order, config);
      return;
    }

    await this.postWhatsAppTextMessage(to, this.buildCustomerConfirmationText(order), config);
  }

  async notifyNewOrder(input: OrderAlertInput) {
    const config = this.getConfig();
    const whatsAppConfig = this.getWhatsAppCloudConfig();
    if (!config.ntfyTopicUrl && config.webhookUrls.length === 0 && !this.shouldAutoSendWhatsAppConfirmation(input, whatsAppConfig)) {
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

    if (this.shouldAutoSendWhatsAppConfirmation(input, whatsAppConfig)) {
      tasks.push(
        this.sendCustomerOrderConfirmation(input, whatsAppConfig).catch((error) => {
          this.logFailure('WHATSAPP', error, {
            orderId: input.order.id,
            phoneNumberId: whatsAppConfig.phoneNumberId,
            mode: whatsAppConfig.mode
          });
        })
      );
    }

    await Promise.all(tasks);
  }

  async notifyDailyOrderDigest(input: DailyOrderDigestInput) {
    const config = this.getDailyDigestConfig();
    if (!config.enabled || !config.ntfyTopicUrl) {
      return {
        sent: false,
        reason: 'DISABLED'
      } as const;
    }

    const message = this.buildDailyDigestBody(input, config.operationsUrl);
    const title = `Resumo do dia - ${this.formatShortDate(`${input.dateKey}T12:00:00-03:00`)}`;
    await this.postNtfy(title, message, {
      ...config,
      operationsUrl: this.buildDigestClickUrl(config.operationsUrl, input.dateKey)
    });
    return {
      sent: true,
      reason: 'SENT'
    } as const;
  }
}
