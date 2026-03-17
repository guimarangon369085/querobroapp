import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  WhatsAppPixDispatchSchema,
  normalizePhoneNumber,
  type WhatsAppPixDispatch
} from '@querobroapp/shared';

type WhatsAppCloudMessageKind = 'SUMMARY' | 'PIX_CODE' | 'ORDER_ALERT';

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
}
