import {
  EXTERNAL_ORDER_FIRST_SLOT_HOUR,
  EXTERNAL_ORDER_FIRST_SLOT_MINUTE,
  EXTERNAL_ORDER_MAX_ORDERS_PER_DAY,
  EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR,
  EXTERNAL_ORDER_OVEN_BATCH_MINUTES,
  EXTERNAL_ORDER_OVEN_CAPACITY_BROAS,
  EXTERNAL_ORDER_SLOT_MINUTES,
  ExternalOrderScheduleAvailabilitySchema,
  formatExternalOrderMinimumSchedule,
  isExternalOrderScheduleAllowed,
  resolveExternalOrderProductionDurationMinutes,
  resolveExternalOrderScheduleAvailability,
  resolveExternalOrderMinimumSchedule
} from '@querobroapp/shared';
import type { z } from 'zod';

export {
  EXTERNAL_ORDER_FIRST_SLOT_HOUR,
  EXTERNAL_ORDER_FIRST_SLOT_MINUTE,
  EXTERNAL_ORDER_MAX_ORDERS_PER_DAY,
  EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR,
  EXTERNAL_ORDER_OVEN_BATCH_MINUTES,
  EXTERNAL_ORDER_OVEN_CAPACITY_BROAS,
  EXTERNAL_ORDER_SLOT_MINUTES,
  isExternalOrderScheduleAllowed,
  resolveExternalOrderProductionDurationMinutes,
  resolveExternalOrderScheduleAvailability,
  resolveExternalOrderMinimumSchedule
};

type ExternalOrderScheduleAvailability = z.infer<typeof ExternalOrderScheduleAvailabilitySchema>;

export function externalOrderScheduleErrorMessage(reference = new Date()) {
  return `Novos pedidos externos so podem ser agendados a partir de ${formatExternalOrderMinimumSchedule(resolveExternalOrderMinimumSchedule(reference))}.`;
}

export function externalOrderScheduleAvailabilityErrorMessage(availability: ExternalOrderScheduleAvailability) {
  const nextLabel = formatExternalOrderMinimumSchedule(new Date(availability.nextAvailableAt));

  if (availability.reason === 'DAY_FULL') {
    return `Esse dia ja atingiu ${availability.dailyLimit} pedidos agendados. Próximo horário: ${nextLabel}.`;
  }

  if (availability.reason === 'SLOT_TAKEN') {
    return `Esse horário nao comporta o tempo de forno necessario. Próximo horário: ${nextLabel}.`;
  }

  return `Próximo horário: ${nextLabel}.`;
}
