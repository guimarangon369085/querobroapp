import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import { WhatsAppPixDispatchSchema, normalizePhoneNumber, type WhatsAppPixDispatch } from '@querobroapp/shared';
import { readBusinessRuntimeProfile } from '../../common/business-profile.js';

type WhatsAppCloudMessageKind = 'SUMMARY' | 'PIX_CODE' | 'ORDER_ALERT' | 'ORDER_CONFIRMATION';

type WhatsAppCloudApiResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string; error_data?: { details?: string } };
};

@Injectable()
export class WhatsAppService {
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
        ? 'O canal ja esta pronto para evoluir para Flow oficial sem trocar a base do pedido.'
        : 'Se ja tiver um pedido em andamento, envie aqui o numero do pedido para atendimento manual.'
    ];

    return lines.filter(Boolean).join('\n');
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
