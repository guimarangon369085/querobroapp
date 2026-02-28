import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
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
      canSendViaMeta: Boolean(flowId),
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

    return {
      sessionId,
      sessionToken,
      previewUrl,
      outboxMessageId: outbox.id,
      canSendViaMeta: Boolean(flowId),
      flowId: flowId || null
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

    await this.prisma.outboxMessage.create({
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

    return {
      ok: true,
      sessionId: data.sessionId,
      customerId: savedCustomer.id,
      orderId: order.id ?? null
    };
  }
}
