import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Inject,
  NotFoundException
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { OutboxStatusEnum } from '@querobroapp/shared';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../../prisma.service.js';
import { z } from 'zod';

const flowSessionScope = 'WHATSAPP_FLOW_ORDER_INTAKE';
const flowSessionTtlMs = 24 * 60 * 60 * 1000;

const orderIntakeLaunchSchema = z.object({
  recipientPhone: z.string().trim().min(8).max(30),
  customerId: z.coerce.number().int().positive().optional(),
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
  order: z.object({
    scheduledAt: z.string().datetime(),
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

const outboxDispatchSchema = z.object({
  messageId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  includeFailed: z.coerce.boolean().optional().default(false)
});

type OrderIntakeProductOption = {
  id: number;
  name: string;
  price: number;
  category: string | null;
};

type OutboxDispatchMode = 'FLOW' | 'TEXT_LINK' | 'TEXT_ONLY' | 'NONE';

type OutboxDispatchResult = {
  outboxId: number;
  template: string;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  transport: OutboxDispatchMode;
  providerMessageId: string | null;
  error: string | null;
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
    scheduledAt: string | null;
    notes: string | null;
  };
  products: OrderIntakeProductOption[];
  createdCustomerId: number | null;
  createdOrderId: number | null;
  submittedAt: string | null;
  submittedPayload: unknown | null;
};

@Injectable()
export class WhatsappService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly ordersService: OrdersService
  ) {}

  private normalizePhone(value?: string | null) {
    const normalized = (value || '').replace(/\D+/g, '');
    if (normalized.length < 10) {
      throw new BadRequestException('Telefone invalido para WhatsApp Flow.');
    }
    return normalized;
  }

  private resolveWebBaseUrl() {
    return (process.env.WHATSAPP_FLOW_WEB_BASE_URL || 'http://127.0.0.1:3000').trim();
  }

  private resolveApiBaseUrl() {
    return (process.env.WHATSAPP_FLOW_API_BASE_URL || 'http://127.0.0.1:3001').trim();
  }

  private resolveCloudApiBaseUrl() {
    return (process.env.WHATSAPP_CLOUD_API_BASE_URL || 'https://graph.facebook.com').trim();
  }

  private resolveCloudApiVersion() {
    return (process.env.WHATSAPP_CLOUD_API_VERSION || 'v21.0').trim();
  }

  private resolveCloudPhoneNumberId() {
    return (process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID || '').trim();
  }

  private resolveCloudAccessToken() {
    return (process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || '').trim();
  }

  private resolveCloudRequestTimeoutMs() {
    const parsed = Number.parseInt(String(process.env.WHATSAPP_CLOUD_REQUEST_TIMEOUT_MS || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 12_000;
    return parsed;
  }

  private resolveBooleanEnv(rawValue: string | undefined, fallback: boolean) {
    if (rawValue == null || rawValue.trim() === '') return fallback;
    const normalized = rawValue.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
  }

  private isOutboxAutoDispatchEnabled() {
    return this.resolveBooleanEnv(process.env.WHATSAPP_OUTBOX_AUTO_DISPATCH_ENABLED, true);
  }

  private hasMetaCloudDeliveryConfig() {
    return Boolean(this.resolveCloudPhoneNumberId() && this.resolveCloudAccessToken());
  }

  private resolveFlowInviteDispatchMode(flowId?: string | null): OutboxDispatchMode {
    if (!this.hasMetaCloudDeliveryConfig()) return 'NONE';
    if ((flowId || '').trim()) return 'FLOW';
    return 'TEXT_LINK';
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
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

  private async loadSessionOrThrow(sessionId: string, token?: string) {
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
    const apiBaseUrl = this.resolveApiBaseUrl();
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
        scheduledAt: session.launch.scheduledAt,
        notes: session.launch.notes
      },
      products: session.products,
      submitEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/submit`,
      sessionToken: token
    };
  }

  private parseOutboxPayload(payload: string) {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {
        rawPayload: parsed
      };
    } catch {
      return {
        rawPayload: payload
      };
    }
  }

  private stringifyOutboxPayloadWithDispatchMeta(
    payload: string,
    dispatchMeta: Record<string, unknown>
  ) {
    const record = this.parseOutboxPayload(payload);
    const previousMeta =
      record.dispatchMeta && typeof record.dispatchMeta === 'object' && !Array.isArray(record.dispatchMeta)
        ? (record.dispatchMeta as Record<string, unknown>)
        : {};

    return JSON.stringify({
      ...record,
      dispatchMeta: {
        ...previousMeta,
        ...dispatchMeta
      }
    });
  }

  private formatCurrencyBr(value: number | null | undefined) {
    const normalized = Number.isFinite(value) ? Number(value) : 0;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(normalized);
  }

  private buildGraphMessagesUrl() {
    const phoneNumberId = this.resolveCloudPhoneNumberId();
    if (!phoneNumberId) {
      throw new BadRequestException('WHATSAPP_CLOUD_PHONE_NUMBER_ID ausente para envio real no WhatsApp.');
    }

    const baseUrl = this.resolveCloudApiBaseUrl().replace(/\/+$/, '');
    const version = this.resolveCloudApiVersion().replace(/^\/+/, '');
    return `${baseUrl}/${version}/${encodeURIComponent(phoneNumberId)}/messages`;
  }

  private async fetchMetaWithTimeout(url: string, init: RequestInit, timeoutMessage: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.resolveCloudRequestTimeoutMs());

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(timeoutMessage);
      }

      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new BadGatewayException(`${timeoutMessage} (${detail})`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readProviderBody(response: Response): Promise<unknown> {
    const raw = await response.text();
    if (!raw) return '';

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  private summarizeProviderBody(body: unknown) {
    if (typeof body === 'string') {
      return body.trim() || 'sem detalhes';
    }

    if (!body || typeof body !== 'object') {
      return 'sem detalhes';
    }

    const record = body as Record<string, unknown>;
    const errors: string[] = [];
    const pushString = (value: unknown) => {
      if (typeof value === 'string' && value.trim()) {
        errors.push(value.trim());
      }
    };

    pushString(record.message);
    pushString(record.error);
    pushString(record.error_description);

    const nestedError = record.error_data;
    if (nestedError && typeof nestedError === 'object' && !Array.isArray(nestedError)) {
      for (const value of Object.values(nestedError)) {
        pushString(value);
      }
    }

    if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
      for (const value of Object.values(record.error as Record<string, unknown>)) {
        pushString(value);
      }
    }

    if (errors.length > 0) {
      return errors.join(' • ');
    }

    try {
      return JSON.stringify(body);
    } catch {
      return 'sem detalhes';
    }
  }

  private async sendCloudApiMessage(payload: Record<string, unknown>) {
    const accessToken = this.resolveCloudAccessToken();
    if (!accessToken) {
      throw new BadRequestException('WHATSAPP_CLOUD_ACCESS_TOKEN ausente para envio real no WhatsApp.');
    }

    const response = await this.fetchMetaWithTimeout(
      this.buildGraphMessagesUrl(),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      },
      'Nao foi possivel enviar a mensagem pela Meta Cloud API.'
    );
    const body = await this.readProviderBody(response);

    if (!response.ok) {
      throw new BadGatewayException(
        `Meta recusou a mensagem (HTTP ${response.status}): ${this.summarizeProviderBody(body)}`
      );
    }

    const messages =
      body && typeof body === 'object' && !Array.isArray(body)
        ? ((body as Record<string, unknown>).messages as Array<Record<string, unknown>> | undefined)
        : undefined;
    const providerMessageId =
      Array.isArray(messages) &&
      messages.find((entry) => entry && typeof entry.id === 'string' && entry.id.trim())?.id;

    return {
      providerMessageId: typeof providerMessageId === 'string' ? providerMessageId.trim() : null,
      body
    };
  }

  private buildOrderIntakeInviteFallbackText(payload: Record<string, unknown>) {
    const previewUrl =
      typeof payload.previewUrl === 'string' && payload.previewUrl.trim()
        ? payload.previewUrl.trim()
        : '';
    if (!previewUrl) {
      throw new BadRequestException('Payload do convite sem previewUrl para fallback de link.');
    }

    return `Monte seu pedido aqui: ${previewUrl}`;
  }

  private buildOrderIntakeCompletedText(payload: Record<string, unknown>) {
    const orderId =
      typeof payload.orderId === 'number' && Number.isFinite(payload.orderId) ? payload.orderId : null;
    return orderId
      ? `Pedido #${orderId} criado com sucesso no QUEROBROAPP. Agora ele segue para confirmacao e producao.`
      : 'Pedido criado com sucesso no QUEROBROAPP.';
  }

  private buildOrderStatusChangedText(payload: Record<string, unknown>) {
    const orderId =
      typeof payload.orderId === 'number' && Number.isFinite(payload.orderId) ? payload.orderId : null;
    const status = typeof payload.status === 'string' ? payload.status.trim() : '';
    const totals =
      payload.totals && typeof payload.totals === 'object' && !Array.isArray(payload.totals)
        ? (payload.totals as Record<string, unknown>)
        : null;
    const balanceDue =
      totals && typeof totals.balanceDue === 'number' && Number.isFinite(totals.balanceDue)
        ? totals.balanceDue
        : null;

    const orderLabel = orderId ? `Pedido #${orderId}` : 'Seu pedido';
    const base = status ? `${orderLabel} agora esta ${status.toLowerCase()}.` : `${orderLabel} teve atualizacao.`;
    if (balanceDue != null && balanceDue > 0) {
      return `${base} Falta receber ${this.formatCurrencyBr(balanceDue)}.`;
    }
    return base;
  }

  private async sendTextMessage(to: string, bodyText: string) {
    return this.sendCloudApiMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhone(to),
      type: 'text',
      text: {
        preview_url: false,
        body: bodyText
      }
    });
  }

  private async sendFlowInviteMessage(to: string, payload: Record<string, unknown>) {
    const flow =
      payload.flow && typeof payload.flow === 'object' && !Array.isArray(payload.flow)
        ? (payload.flow as Record<string, unknown>)
        : null;
    const flowId = flow && typeof flow.flowId === 'string' ? flow.flowId.trim() : '';
    const mode = this.resolveFlowInviteDispatchMode(flowId);

    if (mode === 'NONE') {
      throw new BadRequestException('Credenciais da Meta Cloud API ausentes para disparar o WhatsApp Flow.');
    }

    if (mode === 'TEXT_LINK') {
      return {
        transport: 'TEXT_LINK' as const,
        ...(await this.sendTextMessage(to, this.buildOrderIntakeInviteFallbackText(payload)))
      };
    }

    const flowToken = flow && typeof flow.flowToken === 'string' ? flow.flowToken.trim() : '';
    if (!flowToken) {
      throw new BadRequestException('Payload do convite sem flowToken.');
    }

    const flowMessageVersion =
      flow && typeof flow.flowMessageVersion === 'string' && flow.flowMessageVersion.trim()
        ? flow.flowMessageVersion.trim()
        : '3';
    const flowCta =
      flow && typeof flow.flowCta === 'string' && flow.flowCta.trim() ? flow.flowCta.trim() : 'Montar pedido';
    const flowAction =
      flow && typeof flow.flowAction === 'string' && flow.flowAction.trim()
        ? flow.flowAction.trim()
        : 'navigate';
    const flowActionPayload =
      flow &&
      flow.flowActionPayload &&
      typeof flow.flowActionPayload === 'object' &&
      !Array.isArray(flow.flowActionPayload)
        ? (flow.flowActionPayload as Record<string, unknown>)
        : undefined;

    const providerResponse = await this.sendCloudApiMessage({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhone(to),
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: 'Abra o fluxo para montar seu pedido.'
        },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: flowMessageVersion,
            flow_id: flowId,
            flow_cta: flowCta,
            flow_token: flowToken,
            flow_action: flowAction,
            ...(flowActionPayload ? { flow_action_payload: flowActionPayload } : {})
          }
        }
      }
    });

    return {
      transport: 'FLOW' as const,
      ...providerResponse
    };
  }

  private async sendOutboxMessage(row: {
    id: number;
    to: string;
    template: string;
    payload: string;
    status: string;
  }): Promise<OutboxDispatchResult> {
    if (row.status === 'SENT') {
      return {
        outboxId: row.id,
        template: row.template,
        status: 'SKIPPED',
        transport: 'NONE',
        providerMessageId: null,
        error: null
      };
    }

    const payload = this.parseOutboxPayload(row.payload);

    try {
      const dispatch =
        row.template === 'order_intake_flow_invite'
          ? await this.sendFlowInviteMessage(row.to, payload)
          : row.template === 'order_intake_flow_completed'
            ? {
                transport: 'TEXT_ONLY' as const,
                ...(await this.sendTextMessage(row.to, this.buildOrderIntakeCompletedText(payload)))
              }
            : row.template === 'order_status_changed'
              ? {
                  transport: 'TEXT_ONLY' as const,
                  ...(await this.sendTextMessage(row.to, this.buildOrderStatusChangedText(payload)))
                }
              : (() => {
                  throw new BadRequestException(
                    `Template ${row.template} ainda nao suporta dispatch real da Meta Cloud API.`
                  );
                })();

      await this.prisma.outboxMessage.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          payload: this.stringifyOutboxPayloadWithDispatchMeta(row.payload, {
            lastAttemptAt: new Date().toISOString(),
            lastStatus: 'SENT',
            transport: dispatch.transport,
            providerMessageId: dispatch.providerMessageId
          })
        }
      });

      return {
        outboxId: row.id,
        template: row.template,
        status: 'SENT',
        transport: dispatch.transport,
        providerMessageId: dispatch.providerMessageId,
        error: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao enviar no WhatsApp.';
      await this.prisma.outboxMessage.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          payload: this.stringifyOutboxPayloadWithDispatchMeta(row.payload, {
            lastAttemptAt: new Date().toISOString(),
            lastStatus: 'FAILED',
            error: message
          })
        }
      });

      return {
        outboxId: row.id,
        template: row.template,
        status: 'FAILED',
        transport: 'NONE',
        providerMessageId: null,
        error: message
      };
    }
  }

  private async maybeAutoDispatchOutboxMessage(outboxId: number) {
    if (!this.isOutboxAutoDispatchEnabled() || !this.hasMetaCloudDeliveryConfig()) {
      return {
        attempted: false,
        status: 'PENDING' as const,
        transport: 'NONE' as OutboxDispatchMode,
        providerMessageId: null,
        error: null
      };
    }

    const row = await this.prisma.outboxMessage.findUnique({ where: { id: outboxId } });
    if (!row) {
      return {
        attempted: false,
        status: 'PENDING' as const,
        transport: 'NONE' as OutboxDispatchMode,
        providerMessageId: null,
        error: 'Outbox nao encontrado para auto-dispatch.'
      };
    }

    const result = await this.sendOutboxMessage(row);
    return {
      attempted: true,
      status: result.status === 'SKIPPED' ? 'PENDING' : result.status,
      transport: result.transport,
      providerMessageId: result.providerMessageId,
      error: result.error
    };
  }

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

  async dispatchOutbox(payload: unknown) {
    const data = outboxDispatchSchema.parse(payload ?? {});

    const rows = await this.prisma.outboxMessage.findMany({
      where: data.messageId
        ? {
            id: data.messageId,
            channel: 'whatsapp'
          }
        : {
            channel: 'whatsapp',
            status: {
              in: data.includeFailed ? ['PENDING', 'FAILED'] : ['PENDING']
            }
          },
      orderBy: { id: 'asc' },
      ...(data.messageId ? {} : { take: data.limit })
    });

    if (data.messageId && rows.length === 0) {
      throw new NotFoundException('Mensagem de outbox nao encontrada.');
    }

    const results: OutboxDispatchResult[] = [];
    for (const row of rows) {
      results.push(await this.sendOutboxMessage(row));
    }

    return {
      attempted: results.length,
      sent: results.filter((entry) => entry.status === 'SENT').length,
      failed: results.filter((entry) => entry.status === 'FAILED').length,
      skipped: results.filter((entry) => entry.status === 'SKIPPED').length,
      results
    };
  }

  async launchOrderIntakeFlow(payload: unknown) {
    const data = orderIntakeLaunchSchema.parse(payload);
    const recipientPhone = this.normalizePhone(data.recipientPhone);

    let initialCustomer:
      | {
          id: number;
          name: string;
          phone: string | null;
          address: string | null;
          deliveryNotes: string | null;
        }
      | null = null;

    if (data.customerId) {
      const customer = await this.prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) {
        throw new NotFoundException('Cliente informado para o WhatsApp Flow nao foi encontrado.');
      }
      initialCustomer = {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        deliveryNotes: customer.deliveryNotes
      };
    }

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

    const apiBaseUrl = this.resolveApiBaseUrl();
    const webBaseUrl = this.resolveWebBaseUrl();
    const previewUrl = `${webBaseUrl}/whatsapp-flow/pedido/${sessionId}?token=${sessionToken}`;
    const flowId = (process.env.WHATSAPP_FLOW_ORDER_INTAKE_ID || '').trim();
    const metaDispatchMode = this.resolveFlowInviteDispatchMode(flowId || null);

    const outboxPayload = {
      event: 'ORDER_INTAKE_FLOW_REQUESTED',
      flow: {
        type: 'ORDER_INTAKE',
        flowId: flowId || null,
        flowMessageVersion: '3',
        flowToken: sessionToken,
        flowCta: 'Montar pedido',
        flowAction: 'navigate',
        flowActionPayload: {
          screen: 'ORDER_INTAKE',
          data: {
            sessionId,
            sessionToken,
            formEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/sessions/${sessionId}?token=${sessionToken}`,
            submitEndpoint: `${apiBaseUrl}/whatsapp/flows/order-intake/submit`,
            previewUrl
          }
        }
      },
      recipientPhone,
      canSendViaMeta: metaDispatchMode !== 'NONE',
      metaDispatchMode,
      previewUrl,
      createdAt: new Date().toISOString()
    };

    const outbox = await this.prisma.outboxMessage.create({
      data: {
        messageId: randomUUID(),
        channel: 'whatsapp',
        to: recipientPhone,
        template: 'order_intake_flow_invite',
        payload: JSON.stringify(outboxPayload),
        status: 'PENDING'
      }
    });
    const autoDispatch = await this.maybeAutoDispatchOutboxMessage(outbox.id);

    return {
      sessionId,
      sessionToken,
      previewUrl,
      outboxMessageId: outbox.id,
      canSendViaMeta: metaDispatchMode !== 'NONE',
      metaDispatchMode,
      flowId: flowId || null,
      dispatchStatus: autoDispatch.status,
      dispatchTransport: autoDispatch.transport,
      dispatchError: autoDispatch.error
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

    const normalizedPhone = this.normalizePhone(data.customer.phone);
    const address = data.customer.address?.trim() || null;
    const deliveryNotes = data.customer.deliveryNotes?.trim() || null;

    const customer =
      (session.launch.customerId
        ? await this.prisma.customer.findUnique({ where: { id: session.launch.customerId } })
        : await this.prisma.customer.findFirst({ where: { phone: normalizedPhone } })) || null;

    const savedCustomer = customer
      ? await this.prisma.customer.update({
          where: { id: customer.id },
          data: {
            name: data.customer.name.trim(),
            phone: normalizedPhone,
            address,
            addressLine1: address,
            deliveryNotes
          }
        })
      : await this.prisma.customer.create({
          data: {
            name: data.customer.name.trim(),
            phone: normalizedPhone,
            address,
            addressLine1: address,
            deliveryNotes,
            country: 'Brasil'
          }
        });

    const order = await this.ordersService.create({
      customerId: savedCustomer.id,
      notes: data.order.notes ?? session.launch.notes ?? null,
      discount: data.order.discount ?? 0,
      scheduledAt: data.order.scheduledAt,
      items: data.order.items
    });

    const completedSession: OrderIntakeSessionRecord = {
      ...session,
      status: 'COMPLETED',
      createdCustomerId: savedCustomer.id,
      createdOrderId: order.id ?? null,
      submittedAt: new Date().toISOString(),
      submittedPayload: {
        customer: {
          name: data.customer.name.trim(),
          phone: normalizedPhone,
          address,
          deliveryNotes
        },
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

    const completionOutbox = await this.prisma.outboxMessage.create({
      data: {
        messageId: randomUUID(),
        channel: 'whatsapp',
        to: normalizedPhone,
        template: 'order_intake_flow_completed',
        payload: JSON.stringify({
          event: 'ORDER_INTAKE_FLOW_COMPLETED',
          sessionId: data.sessionId,
          customerId: savedCustomer.id,
          orderId: order.id ?? null,
          createdAt: new Date().toISOString()
        }),
        status: 'PENDING',
        orderId: order.id ?? null
      }
    });
    const autoDispatch = await this.maybeAutoDispatchOutboxMessage(completionOutbox.id);

    return {
      ok: true,
      sessionId: data.sessionId,
      customerId: savedCustomer.id,
      orderId: order.id ?? null,
      dispatchStatus: autoDispatch.status,
      dispatchTransport: autoDispatch.transport,
      dispatchError: autoDispatch.error
    };
  }
}
