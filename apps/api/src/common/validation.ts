import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseWithSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
