import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export function parseWithSchema<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
