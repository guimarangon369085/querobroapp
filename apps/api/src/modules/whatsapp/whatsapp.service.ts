import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  OrderFulfillmentModeEnum,
  WhatsAppPixDispatchSchema,
  normalizePhoneNumber,
  type WhatsAppPixDispatch
} from '@querobroapp/shared';
import { z } from 'zod';
import { readBusinessRuntimeProfile } from '../../common/business-profile.js';
import { PrismaService } from '../../prisma.service.js';

type OrdersServiceBridge = {
  intakeWhatsAppFlow(payload: unknown): Promise<{
    order: { id: number | null };
    intake: { customerId: number };
  }>;
};

type WhatsAppCloudMessageKind =
  | 'SUMMARY'
  | 'PIX_CODE'
  | 'ORDER_ALERT'
  | 'ORDER_CONFIRMATION'
  | 'FLOW_INVITE'
  | 'FLOW_FALLBACK';

type WhatsAppCloudApiResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; error_data?: { details?: string } };
};

type WhatsAppFlowInviteDispatchMode = 'FLOW' | 'TEXT_LINK' | 'NONE';
type WhatsAppFlowDispatchStatus = 'SENT' | 'SKIPPED' | 'FAILED';

type OrderIntakeProductOption = {
  id: number;
  name: string;
  price: number;
  category: string | null;
};

type OrderIntakeSessionRecord = {
  version: 1;
  type: 'ORDER_INTAKE';
  status: 'PENDING' | 'COMPLETED';
  recipientPhone: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  launch: {
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    address: string | null;
    deliveryNotes: string | null;
    fulfillmentMode: 'DELIVERY' | 'PICKUP';
    scheduledAt: string | null;
    notes: string | null;
  };
  products: OrderIntakeProductOption[];
  createdCustomerId: number | null;
  createdOrderId: number | null;
  submittedAt: string | null;
  submittedPayload: unknown | null;
};

const flowSessionScope = 'WHATSAPP_FLOW_ORDER_INTAKE';
const flowSessionTtlMs = 24 * 60 * 60 * 1000;

const orderIntakeLaunchSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(30),
  customerId: z.coerce.number().int().positive().optional(),
  fulfillmentMode: OrderFulfillmentModeEnum.optional().default('DELIVERY'),
  scheduledAt: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable()
});

const orderIntakeSubmitSchema = z.object({
  sessionId: z.string().trim().uuid(),
  token: z.string().trim().uuid(),
  customer: z.object({
    name: z.string().trim().min(2).max(140),
    phone: z.string().trim().min(8).max(30),
    address: z.string().trim().max(240).optional().nullable(),
    deliveryNotes: z.string().trim().max(240).optional().nullable()
  }),
  fulfillment: z.object({
    mode: OrderFulfillmentModeEnum.default('DELIVERY'),
    scheduledAt: z.string().datetime()
  }),
  order: z.object({
    notes: z.string().trim().max(500).optional().nullable(),
    discount: z.coerce.number().min(0).max(1_000_000).optional().default(0),
    items: z
      .array(
        z.object({
          productId: z.coerce.number().int().positive(),
          quantity: z.coerce.number().int().positive().max(999)
        })
      )
      .min(1)
      .max(30)
  })
});

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject('ORDERS_SERVICE') private readonly ordersService: OrdersServiceBridge
  ) {}

  private readonly defaultTimeoutMs = 15_000;

  private getConfig() {
    const token = (process.env.WHATSAPP_CLOUD_API_TOKEN || '').trim();
    const phoneNumberId = (process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || '').trim();
    const version = (process.env.WHATSAPP_CLOUD_API_VERSION || 'v23.0').trim();
    const baseUrl = (process.env.WHATSAPP_CLOUD_API_BASE_URL || 'https://graph.facebook.com').trim().replace(
      /\/+$/,
      ''
    );
    return { token, phoneNumberId, version, baseUrl };
  }

  private assertConfigured() {
    const config = this.getConfig();
    if (!config.token || !config.phoneNumberId) {
      throw new ServiceUnavailableException(
        'WhatsApp Cloud API nao configurada. Defina WHATSAPP_CLOUD_API_TOKEN e WHATSAPP_CLOUD_PHONE_NUMBER_ID.'
      );
    }
    return config;
  }

  private hasCloudApiConfig() {
    const config = this.getConfig();
    return Boolean(config.token && config.phoneNumberId);
  }

  private getWebhookConfig() {
    return {
      verifyToken: String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim(),
      defaultOrderEntryUrl:
        String(process.env.WHATSAPP_DEFAULT_ORDER_ENTRY_URL || 'https://querobroa.com.br/pedido').trim() ||
        'https://querobroa.com.br/pedido',
      autoReplyEnabled: String(process.env.WHATSAPP_AUTO_REPLY_ENABLED || 'false').trim().toLowerCase() === 'true',
      flowId: String(process.env.WHATSAPP_FLOW_ORDER_INTAKE_ID || '').trim()
    };
  }

  private resolveFlowApiBaseUrl() {
    const explicitBaseUrl =
      String(process.env.WHATSAPP_FLOW_API_BASE_URL || process.env.ORDER_FORM_API_URL || process.env.NEXT_PUBLIC_API_URL || '')
        .trim()
        .replace(/\/+$/, '');
    if (explicitBaseUrl) return explicitBaseUrl;
    if ((process.env.NODE_ENV || 'development') === 'production') {
      return 'https://api.querobroa.com.br';
    }
    return 'http://127.0.0.1:3001';
  }

  private normalizeRecipientPhone(value?: string | null) {
    const normalized = normalizePhoneNumber(value);
    if (!normalized) {
      throw new BadRequestException('Cliente sem telefone valido para WhatsApp.');
    }
    if (normalized.startsWith('55')) return normalized;
    if (normalized.length === 10 || normalized.length === 11) return `55${normalized}`;
    return normalized;
  }

  private messageUrl() {
    const config = this.assertConfigured();
    return `${config.baseUrl}/${config.version}/${config.phoneNumberId}/messages`;
  }

  private buildInboundOrderReply(messageBody?: string | null) {
    const config = this.getWebhookConfig();
    const businessProfile = readBusinessRuntimeProfile();
    const normalizedMessage = String(messageBody || '').trim().toLowerCase();
    const customerAskedAboutPix = normalizedMessage.includes('pix') || normalizedMessage.includes('pag');
    const lines = [
      'Oi! Aqui e a QUEROBROA.',
      `Para montar seu pedido, use o link oficial: ${config.defaultOrderEntryUrl}`,
      customerAskedAboutPix
        ? `O PIX oficial da QUEROBROA e ${businessProfile.pixKey}.`
        : `WhatsApp oficial: ${businessProfile.officialPhoneDisplay}.`,
      config.flowId
        ? 'O canal oficial do WhatsApp ja pode abrir o fluxo estruturado de pedido.'
        : 'Se ja tiver um pedido em andamento, envie aqui o numero do pedido para atendimento manual.'
    ];

    return lines.filter(Boolean).join('\n');
  }

  private buildFlowInviteFallbackText() {
    const { defaultOrderEntryUrl } = this.getWebhookConfig();
    return `Monte seu pedido aqui: ${defaultOrderEntryUrl}`;
  }

  private extractInboundTextMessages(payload: unknown) {
    if (!payload || typeof payload !== 'object') return [];
    const record = payload as {
      entry?: Array<{
        changes?: Array<{
          value?: {
            messages?: Array<{
              from?: string;
              id?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
            }>;
          };
        }>;
      }>;
    };

    const messages: Array<{ from: string; messageId: string | null; body: string; timestamp: string | null }> = [];
    for (const entry of record.entry || []) {
      for (const change of entry.changes || []) {
        for (const message of change.value?.messages || []) {
          if (message.type !== 'text') continue;
          let from = '';
          try {
            from = this.normalizeRecipientPhone(message.from);
          } catch {
            from = '';
          }
          const body = String(message.text?.body || '').trim();
          if (!from || !body) continue;
          messages.push({
            from,
            messageId: String(message.id || '').trim() || null,
            body,
            timestamp: String(message.timestamp || '').trim() || null
          });
        }
      }
    }
    return messages;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveFlowInviteDispatchMode(flowId?: string | null): WhatsAppFlowInviteDispatchMode {
    if (!this.hasCloudApiConfig()) return 'NONE';
    return String(flowId || '').trim() ? 'FLOW' : 'TEXT_LINK';
  }

  private parseSessionRecord(responseJson: string) {
    try {
      return JSON.parse(responseJson) as OrderIntakeSessionRecord;
    } catch {
      throw new BadRequestException('Sessao de WhatsApp Flow corrompida.');
    }
  }

  private async readSession(sessionId: string) {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: {
        scope_idemKey: {
          scope: flowSessionScope,
          idemKey: sessionId
        }
      }
    });

    if (!existing) return null;

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
      return null;
    }

    return existing;
  }

  private async writeSession(sessionId: string, requestHash: string, session: OrderIntakeSessionRecord) {
    const expiresAt = new Date(session.expiresAt);
    const responseJson = JSON.stringify(session);
    const existing = await this.readSession(sessionId);

    if (!existing) {
      await this.prisma.idempotencyRecord.create({
        data: {
          scope: flowSessionScope,
          idemKey: sessionId,
          requestHash,
          responseJson,
          expiresAt
        }
      });
      return;
    }

    await this.prisma.idempotencyRecord.update({
      where: {
        scope_idemKey: {
          scope: flowSessionScope,
          idemKey: sessionId
        }
      },
      data: {
        requestHash,
        responseJson,
        expiresAt
      }
    });
  }

  private async loadSessionOrThrow(sessionId: string, token?: string | null) {
    if (!token?.trim()) {
      throw new BadRequestException('Token da sessao obrigatorio.');
    }

    const existing = await this.readSession(sessionId);
    if (!existing) {
      throw new NotFoundException('Sessao de WhatsApp Flow nao encontrada ou expirada.');
    }

    const session = this.parseSessionRecord(existing.responseJson);
    if (session.tokenHash !== this.hashToken(token.trim())) {
      throw new BadRequestException('Token da sessao invalido.');
    }

    return { existing, session };
  }

  private buildSessionView(sessionId: string, token: string, session: OrderIntakeSessionRecord) {
    const apiBaseUrl = this.resolveFlowApiBaseUrl();
    const { defaultOrderEntryUrl } = this.getWebhookConfig();

    return {
      sessionId,
      status: session.status,
      expiresAt: session.expiresAt,
      createdOrderId: session.createdOrderId,
      createdCustomerId: session.createdCustomerId,
      prefill: {
        customerName: session.launch.customerName,
        customerPhone: session.launch.customerPhone || session.recipientPhone,
        address: session.launch.address,
        deliveryNotes: session.launch.deliveryNotes,
        fulfillmentMode: session.launch.fulfillmentMode,
        scheduledAt: session.launch.scheduledAt,
        notes: session.launch.notes
      },
      products: session.products,
      orderEntryUrl: defaultOrderEntryUrl,
      sessionEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/sessions/${sessionId}?token=${token}`,
      submitEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/submit`,
      sessionToken: token
    };
  }

  private async resolveInitialCustomer(recipientPhone: string, customerId?: number) {
    if (customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer || customer.deletedAt) {
        throw new NotFoundException('Cliente informado para o WhatsApp Flow nao foi encontrado.');
      }
      return customer;
    }

    return this.prisma.customer.findFirst({
      where: {
        deletedAt: null,
        OR: [{ activePhoneKey: recipientPhone }, { phone: recipientPhone }]
      },
      orderBy: { id: 'desc' }
    });
  }

  private async dispatchFlowInvite(input: {
    to: string;
    flowId: string | null;
    sessionId: string;
    sessionToken: string;
  }) {
    const mode = this.resolveFlowInviteDispatchMode(input.flowId);
    if (mode === 'NONE') {
      return {
        dispatchStatus: 'SKIPPED' as WhatsAppFlowDispatchStatus,
        dispatchTransport: 'NONE' as WhatsAppFlowInviteDispatchMode,
        dispatchError: null,
        providerMessageId: null
      };
    }

    if (mode === 'TEXT_LINK') {
      const message = await this.postTextMessage({
        to: input.to,
        kind: 'FLOW_FALLBACK',
        body: this.buildFlowInviteFallbackText()
      });
      return {
        dispatchStatus: 'SENT' as WhatsAppFlowDispatchStatus,
        dispatchTransport: 'TEXT_LINK' as WhatsAppFlowInviteDispatchMode,
        dispatchError: null,
        providerMessageId: message.messageId
      };
    }

    try {
      const apiBaseUrl = this.resolveFlowApiBaseUrl();
      const { defaultOrderEntryUrl } = this.getWebhookConfig();
      const interactiveMessage = await this.postInteractiveFlowMessage({
        to: input.to,
        flowId: input.flowId!,
        flowToken: input.sessionToken,
        sessionId: input.sessionId,
        sessionToken: input.sessionToken,
        sessionEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/sessions/${input.sessionId}?token=${input.sessionToken}`,
        submitEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/submit`,
        orderEntryUrl: defaultOrderEntryUrl
      });

      return {
        dispatchStatus: 'SENT' as WhatsAppFlowDispatchStatus,
        dispatchTransport: 'FLOW' as WhatsAppFlowInviteDispatchMode,
        dispatchError: null,
        providerMessageId: interactiveMessage.messageId
      };
    } catch (error) {
      const fallbackMessage = await this.postTextMessage({
        to: input.to,
        kind: 'FLOW_FALLBACK',
        body: this.buildFlowInviteFallbackText()
      });
      return {
        dispatchStatus: 'SENT' as WhatsAppFlowDispatchStatus,
        dispatchTransport: 'TEXT_LINK' as WhatsAppFlowInviteDispatchMode,
        dispatchError: error instanceof Error ? error.message : 'flow_dispatch_failed',
        providerMessageId: fallbackMessage.messageId
      };
    }
  }

  async verifyWebhookSubscription(mode?: string | null, token?: string | null, challenge?: string | null) {
    const config = this.getWebhookConfig();
    if (!config.verifyToken) {
      throw new ServiceUnavailableException(
        'Webhook do WhatsApp nao configurado. Defina WHATSAPP_WEBHOOK_VERIFY_TOKEN.'
      );
    }
    if (String(mode || '').trim() !== 'subscribe' || String(token || '').trim() !== config.verifyToken) {
      throw new UnauthorizedException('Handshake do webhook do WhatsApp invalido.');
    }
    return String(challenge || '').trim();
  }

  async handleWebhookEvent(payload: unknown) {
    const config = this.getWebhookConfig();
    const cloudConfig = this.getConfig();
    const businessProfile = readBusinessRuntimeProfile();
    const inboundMessages = this.extractInboundTextMessages(payload);
    const deliveries = [];
    const canSendReplies = config.autoReplyEnabled && Boolean(cloudConfig.token && cloudConfig.phoneNumberId);

    if (canSendReplies && inboundMessages.length > 0) {
      for (const message of inboundMessages) {
        if (config.flowId) {
          deliveries.push(
            this.launchOrderIntakeFlow({ recipientPhone: message.from }).then((launch) => ({
              from: message.from,
              messageId: message.messageId,
              replyMessageId: launch.providerMessageId,
              sessionId: launch.sessionId,
              dispatchTransport: launch.dispatchTransport
            }))
          );
          continue;
        }

        deliveries.push(
          this.postTextMessage({
            to: message.from,
            kind: 'ORDER_ALERT',
            body: this.buildInboundOrderReply(message.body)
          }).then((delivery) => ({
            from: message.from,
            messageId: message.messageId,
            replyMessageId: delivery.messageId
          }))
        );
      }
    }

    const settledReplies = await Promise.allSettled(deliveries);
    return {
      ok: true,
      autoReplyEnabled: config.autoReplyEnabled,
      canSendReplies,
      flowReady: Boolean(config.flowId),
      defaultOrderEntryUrl: config.defaultOrderEntryUrl,
      businessPhone: businessProfile.officialPhoneDisplay,
      receivedMessages: inboundMessages.length,
      replies: settledReplies.map((entry) =>
        entry.status === 'fulfilled'
          ? { ok: true, ...entry.value }
          : {
              ok: false,
              error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason || 'reply_failed')
            }
      )
    };
  }

  private async postTextMessage(input: {
    to: string;
    body: string;
    kind: WhatsAppCloudMessageKind;
  }): Promise<{ kind: WhatsAppCloudMessageKind; messageId: string }> {
    const config = this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    try {
      const response = await fetch(this.messageUrl(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.to,
          type: 'text',
          text: {
            preview_url: false,
            body: input.body
          }
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as WhatsAppCloudApiResponse;
      if (!response.ok) {
        const detail = payload.error?.error_data?.details || payload.error?.message || `HTTP ${response.status}`;
        throw new ServiceUnavailableException(`Falha ao enviar WhatsApp: ${detail}`);
      }

      const messageId = payload.messages?.[0]?.id?.trim();
      if (!messageId) {
        throw new ServiceUnavailableException('WhatsApp Cloud API respondeu sem ID da mensagem.');
      }

      return {
        kind: input.kind,
        messageId
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async postInteractiveFlowMessage(input: {
    to: string;
    flowId: string;
    flowToken: string;
    sessionId: string;
    sessionToken: string;
    sessionEndpoint: string;
    submitEndpoint: string;
    orderEntryUrl: string;
  }): Promise<{ kind: 'FLOW_INVITE'; messageId: string }> {
    const config = this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);

    try {
      const response = await fetch(this.messageUrl(), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: input.to,
          type: 'interactive',
          interactive: {
            type: 'flow',
            body: {
              text: 'Abra o fluxo para montar seu pedido.'
            },
            action: {
              name: 'flow',
              parameters: {
                flow_message_version: '3',
                flow_id: input.flowId,
                flow_cta: 'Montar pedido',
                flow_token: input.flowToken,
                flow_action: 'navigate',
                flow_action_payload: {
                  screen: 'ORDER_INTAKE',
                  data: {
                    sessionId: input.sessionId,
                    sessionToken: input.sessionToken,
                    sessionEndpoint: input.sessionEndpoint,
                    submitEndpoint: input.submitEndpoint,
                    orderEntryUrl: input.orderEntryUrl
                  }
                }
              }
            }
          }
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as WhatsAppCloudApiResponse;
      if (!response.ok) {
        const detail = payload.error?.error_data?.details || payload.error?.message || `HTTP ${response.status}`;
        throw new ServiceUnavailableException(`Falha ao enviar WhatsApp Flow: ${detail}`);
      }

      const messageId = payload.messages?.[0]?.id?.trim();
      if (!messageId) {
        throw new ServiceUnavailableException('WhatsApp Cloud API respondeu sem ID da mensagem interativa.');
      }

      return {
        kind: 'FLOW_INVITE',
        messageId
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async launchOrderIntakeFlow(payload: unknown) {
    const data = orderIntakeLaunchSchema.parse(payload);
    const recipientPhone = this.normalizeRecipientPhone(data.recipientPhone);
    const initialCustomer = await this.resolveInitialCustomer(recipientPhone, data.customerId);

    const products = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }]
    });
    if (products.length === 0) {
      throw new BadRequestException('Nenhum produto ativo disponivel para o WhatsApp Flow.');
    }

    const sessionId = randomUUID();
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + flowSessionTtlMs).toISOString();

    const session: OrderIntakeSessionRecord = {
      version: 1,
      type: 'ORDER_INTAKE',
      status: 'PENDING',
      recipientPhone,
      tokenHash: this.hashToken(sessionToken),
      createdAt: new Date().toISOString(),
      expiresAt,
      launch: {
        customerId: initialCustomer?.id ?? null,
        customerName: initialCustomer?.name ?? null,
        customerPhone: initialCustomer?.phone ?? recipientPhone,
        address: initialCustomer?.address ?? null,
        deliveryNotes: initialCustomer?.deliveryNotes ?? null,
        fulfillmentMode: data.fulfillmentMode,
        scheduledAt: data.scheduledAt ?? null,
        notes: data.notes ?? null
      },
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        category: product.category ?? null
      })),
      createdCustomerId: null,
      createdOrderId: null,
      submittedAt: null,
      submittedPayload: null
    };

    await this.writeSession(sessionId, session.tokenHash, session);

    const apiBaseUrl = this.resolveFlowApiBaseUrl();
    const { defaultOrderEntryUrl, flowId } = this.getWebhookConfig();
    const metaDispatchMode = this.resolveFlowInviteDispatchMode(flowId || null);
    const dispatch = await this.dispatchFlowInvite({
      to: recipientPhone,
      flowId: flowId || null,
      sessionId,
      sessionToken
    });

    return {
      sessionId,
      sessionToken,
      orderEntryUrl: defaultOrderEntryUrl,
      previewUrl: defaultOrderEntryUrl,
      sessionEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/sessions/${sessionId}?token=${sessionToken}`,
      submitEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/submit`,
      canSendViaMeta: metaDispatchMode !== 'NONE',
      metaDispatchMode,
      flowId: flowId || null,
      providerMessageId: dispatch.providerMessageId,
      dispatchStatus: dispatch.dispatchStatus,
      dispatchTransport: dispatch.dispatchTransport,
      dispatchError: dispatch.dispatchError
    };
  }

  async getOrderIntakeSession(sessionId: string, token?: string) {
    const { session } = await this.loadSessionOrThrow(sessionId, token);
    return this.buildSessionView(sessionId, token!.trim(), session);
  }

  async submitOrderIntakeFlow(payload: unknown) {
    const data = orderIntakeSubmitSchema.parse(payload);
    const { existing, session } = await this.loadSessionOrThrow(data.sessionId, data.token);

    if (session.status === 'COMPLETED') {
      return {
        ok: true,
        sessionId: data.sessionId,
        customerId: session.createdCustomerId,
        orderId: session.createdOrderId,
        alreadyCompleted: true
      };
    }

    const allowedProductIds = new Set(session.products.map((product) => product.id));
    for (const item of data.order.items) {
      if (!allowedProductIds.has(item.productId)) {
        throw new BadRequestException(`Produto ${item.productId} nao pertence a esta sessao de WhatsApp Flow.`);
      }
    }

    const created = await this.ordersService.intakeWhatsAppFlow({
      version: 1,
      intent: 'CONFIRMED',
      customer: {
        name: data.customer.name.trim(),
        phone: data.customer.phone,
        address: data.customer.address ?? null,
        deliveryNotes: data.customer.deliveryNotes ?? null
      },
      fulfillment: {
        mode: data.fulfillment.mode,
        scheduledAt: data.fulfillment.scheduledAt
      },
      order: {
        items: data.order.items,
        discount: data.order.discount ?? 0,
        notes: data.order.notes ?? session.launch.notes ?? null
      },
      payment: {
        method: 'pix',
        status: 'PENDENTE',
        dueAt: data.fulfillment.scheduledAt
      },
      source: {
        externalId: `whatsapp-flow-session:${data.sessionId}`,
        idempotencyKey: `whatsapp-flow-session:${data.sessionId}`,
        originLabel: 'whatsapp-flow-session'
      }
    });

    const completedSession: OrderIntakeSessionRecord = {
      ...session,
      status: 'COMPLETED',
      createdCustomerId: created.intake.customerId,
      createdOrderId: created.order.id ?? null,
      submittedAt: new Date().toISOString(),
      submittedPayload: {
        customer: {
          name: data.customer.name.trim(),
          phone: this.normalizeRecipientPhone(data.customer.phone),
          address: data.customer.address ?? null,
          deliveryNotes: data.customer.deliveryNotes ?? null
        },
        fulfillment: data.fulfillment,
        order: data.order
      }
    };

    await this.prisma.idempotencyRecord.update({
      where: {
        scope_idemKey: {
          scope: flowSessionScope,
          idemKey: data.sessionId
        }
      },
      data: {
        requestHash: existing.requestHash,
        responseJson: JSON.stringify(completedSession),
        expiresAt: new Date(completedSession.expiresAt)
      }
    });

    return {
      ok: true,
      sessionId: data.sessionId,
      customerId: completedSession.createdCustomerId,
      orderId: completedSession.createdOrderId,
      alreadyCompleted: false
    };
  }

  async sendPixCharge(input: {
    customerName: string;
    phone: string;
    orderId: number;
    amountLabel: string;
    copyPasteCode: string;
  }): Promise<WhatsAppPixDispatch> {
    const to = this.normalizeRecipientPhone(input.phone);
    const customerLabel = input.customerName.trim() || 'cliente';
    const messageLines = [
      `Oi, ${customerLabel}.`,
      `Segue o PIX do pedido #${input.orderId}.`,
      `Valor: ${input.amountLabel}.`,
      '',
      'Codigo PIX copia e cola:',
      input.copyPasteCode.trim()
    ];

    const messages = [
      await this.postTextMessage({
        to,
        kind: 'SUMMARY',
        body: messageLines.join('\n')
      })
    ];

    return WhatsAppPixDispatchSchema.parse({
      provider: 'WHATSAPP_CLOUD_API',
      to,
      sentAt: new Date().toISOString(),
      messages
    });
  }

  async sendOrderAlert(input: { phone: string; body: string }) {
    const to = this.normalizeRecipientPhone(input.phone);
    const message = await this.postTextMessage({
      to,
      kind: 'ORDER_ALERT',
      body: input.body.trim()
    });

    return {
      provider: 'WHATSAPP_CLOUD_API' as const,
      to,
      sentAt: new Date().toISOString(),
      message
    };
  }

  async sendOrderConfirmation(input: {
    customerName: string;
    phone: string;
    orderNumber: number | string;
    paymentPending: boolean;
  }) {
    const to = this.normalizeRecipientPhone(input.phone);
    const body = 'Seu pedido foi confirmado ❤️\nVc vai receber um aviso quando suas broinhas sairem para entrega :)';

    const message = await this.postTextMessage({
      to,
      kind: 'ORDER_CONFIRMATION',
      body
    });

    return {
      provider: 'WHATSAPP_CLOUD_API' as const,
      to,
      sentAt: new Date().toISOString(),
      message
    };
  }
}
