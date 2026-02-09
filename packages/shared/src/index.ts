import { z } from 'zod';

export const OrderStatusEnum = z.enum([
  'ABERTO',
  'CONFIRMADO',
  'EM_PREPARACAO',
  'PRONTO',
  'ENTREGUE',
  'CANCELADO'
]);

export const PaymentStatusEnum = z.enum(['PENDENTE', 'PAGO', 'CANCELADO']);

export const StockMovementTypeEnum = z.enum(['IN', 'OUT', 'ADJUST']);

export const CustomerSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable()
});

export const ProductSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  active: z.boolean().default(true),
  createdAt: z.string().optional().nullable()
});

export const OrderItemSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive().optional(),
  productId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional()
});

export const OrderSchema = z.object({
  id: z.number().int().positive().optional(),
  customerId: z.number().int().positive(),
  status: OrderStatusEnum.default('ABERTO'),
  subtotal: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  notes: z.string().optional().nullable(),
  createdAt: z.string().optional().nullable(),
  items: z.array(OrderItemSchema).optional()
});

export const PaymentSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  method: z.string().min(1),
  status: PaymentStatusEnum.default('PENDENTE'),
  paidAt: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  providerRef: z.string().optional().nullable()
});

export const StockMovementSchema = z.object({
  id: z.number().int().positive().optional(),
  productId: z.number().int().positive(),
  type: StockMovementTypeEnum,
  quantity: z.number().int(),
  reason: z.string().optional().nullable(),
  orderId: z.number().int().positive().optional().nullable(),
  createdAt: z.string().optional().nullable()
});

export type OrderStatus = z.infer<typeof OrderStatusEnum>;
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;
export type StockMovementType = z.infer<typeof StockMovementTypeEnum>;

export type Customer = z.infer<typeof CustomerSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type StockMovement = z.infer<typeof StockMovementSchema>;
