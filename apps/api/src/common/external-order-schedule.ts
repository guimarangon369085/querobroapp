export const EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR = 22;
export const EXTERNAL_ORDER_FIRST_SLOT_HOUR = 8;
export const EXTERNAL_ORDER_FIRST_SLOT_MINUTE = 0;

export function resolveExternalOrderMinimumSchedule(reference = new Date()) {
  const minimum = new Date(reference);
  const dayOffset = minimum.getHours() >= EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR ? 2 : 1;
  minimum.setDate(minimum.getDate() + dayOffset);
  minimum.setHours(EXTERNAL_ORDER_FIRST_SLOT_HOUR, EXTERNAL_ORDER_FIRST_SLOT_MINUTE, 0, 0);
  return minimum;
}

export function isExternalOrderScheduleAllowed(scheduledAt: Date | null, reference = new Date()) {
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) return false;
  return scheduledAt.getTime() >= resolveExternalOrderMinimumSchedule(reference).getTime();
}

export function externalOrderScheduleErrorMessage() {
  return 'Novos pedidos externos so podem ser agendados para o dia seguinte. Apos 22:00, a agenda abre para o segundo dia seguinte, a partir de 08:00.';
}
