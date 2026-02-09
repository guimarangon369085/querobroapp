import { z } from 'zod';

export const ProductSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative().default(0)
});

export const ClientSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable()
});

export const OrderItemSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().int().positive()
});

export const OrderSchema = z.object({
  id: z.number().int().positive().optional(),
  clientId: z.number().int().positive(),
  status: z.string().default('aberto'),
  items: z.array(OrderItemSchema).default([])
});

export const PaymentSchema = z.object({
  id: z.number().int().positive().optional(),
  orderId: z.number().int().positive(),
  amount: z.number().nonnegative(),
  method: z.string().min(1),
  status: z.string().default('pendente'),
  paidAt: z.string().optional().nullable()
});

export type Product = z.infer<typeof ProductSchema>;
export type Client = z.infer<typeof ClientSchema>;
export type Order = z.infer<typeof OrderSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
