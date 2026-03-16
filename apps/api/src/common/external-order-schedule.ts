import {
  EXTERNAL_ORDER_FIRST_SLOT_HOUR,
  EXTERNAL_ORDER_FIRST_SLOT_MINUTE,
  EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR,
  formatExternalOrderMinimumSchedule,
  isExternalOrderScheduleAllowed,
  resolveExternalOrderMinimumSchedule
} from '@querobroapp/shared';

export {
  EXTERNAL_ORDER_FIRST_SLOT_HOUR,
  EXTERNAL_ORDER_FIRST_SLOT_MINUTE,
  EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR,
  isExternalOrderScheduleAllowed,
  resolveExternalOrderMinimumSchedule
};

export function externalOrderScheduleErrorMessage(reference = new Date()) {
  return `Novos pedidos externos so podem ser agendados a partir de ${formatExternalOrderMinimumSchedule(resolveExternalOrderMinimumSchedule(reference))}.`;
}
