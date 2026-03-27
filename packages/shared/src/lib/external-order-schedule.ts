export const EXTERNAL_ORDER_TIME_ZONE = 'America/Sao_Paulo';
export const EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR = 22;
export const EXTERNAL_ORDER_FIRST_SLOT_HOUR = 9;
export const EXTERNAL_ORDER_FIRST_SLOT_MINUTE = 0;
export const EXTERNAL_ORDER_SLOT_MINUTES = 15;
export const EXTERNAL_ORDER_MAX_ORDERS_PER_DAY = 15;
export const EXTERNAL_ORDER_OVEN_CAPACITY_BROAS = 14;
export const EXTERNAL_ORDER_OVEN_BATCH_MINUTES = 60;

type ExternalOrderScheduleAvailabilityReason = 'AVAILABLE' | 'BEFORE_MINIMUM' | 'SLOT_TAKEN' | 'DAY_FULL';

type ExternalOrderScheduleEntryInput = {
  scheduledAt: Date | string | null | undefined;
  totalBroas?: number | null | undefined;
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getFormatter(timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
}

function readParts(reference: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE): ZonedDateParts {
  const rawParts = getFormatter(timeZone).formatToParts(reference);
  const map = Object.fromEntries(rawParts.map((entry) => [entry.type, entry.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function resolveTimeZoneOffsetMilliseconds(reference: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const zoned = readParts(reference, timeZone);
  const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second, 0);
  return zonedAsUtc - reference.getTime();
}

function zonedDateTimeToUtc(
  parts: Pick<ZonedDateParts, 'year' | 'month' | 'day' | 'hour' | 'minute'> & { second?: number },
  timeZone = EXTERNAL_ORDER_TIME_ZONE
) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
    0
  );
  const firstOffset = resolveTimeZoneOffsetMilliseconds(new Date(utcGuess), timeZone);
  let adjusted = utcGuess - firstOffset;
  const secondOffset = resolveTimeZoneOffsetMilliseconds(new Date(adjusted), timeZone);
  if (secondOffset !== firstOffset) {
    adjusted = utcGuess - secondOffset;
  }
  return new Date(adjusted);
}

function normalizeQuarterMinute(minute: number, slotMinutes = EXTERNAL_ORDER_SLOT_MINUTES) {
  const normalizedSlotMinutes = Math.max(Math.floor(slotMinutes), 1);
  return Math.ceil(minute / normalizedSlotMinutes) * normalizedSlotMinutes;
}

function normalizeExternalOrderBroaCount(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.floor(parsed), 0);
}

export function resolveExternalOrderProductionBatchCount(totalBroas: number | null | undefined) {
  const normalizedTotalBroas = normalizeExternalOrderBroaCount(totalBroas);
  if (normalizedTotalBroas <= 0) return 0;
  return Math.ceil(normalizedTotalBroas / EXTERNAL_ORDER_OVEN_CAPACITY_BROAS);
}

export function resolveExternalOrderProductionDurationMinutes(totalBroas: number | null | undefined) {
  return resolveExternalOrderProductionBatchCount(totalBroas) * EXTERNAL_ORDER_OVEN_BATCH_MINUTES;
}

export function resolveExternalOrderProductionWindow(
  scheduledAt: Date | string | null | undefined,
  totalBroas: number | null | undefined
) {
  const parsedScheduledAt = scheduledAt instanceof Date ? new Date(scheduledAt) : new Date(scheduledAt ?? Number.NaN);
  if (Number.isNaN(parsedScheduledAt.getTime())) {
    return {
      scheduledAt: new Date(Number.NaN),
      productionStartAt: new Date(Number.NaN),
      totalBroas: 0,
      durationMinutes: 0,
      batchCount: 0
    };
  }

  const normalizedTotalBroas = normalizeExternalOrderBroaCount(totalBroas);
  const durationMinutes = resolveExternalOrderProductionDurationMinutes(normalizedTotalBroas);

  return {
    scheduledAt: parsedScheduledAt,
    productionStartAt: new Date(parsedScheduledAt.getTime() - durationMinutes * 60_000),
    totalBroas: normalizedTotalBroas,
    durationMinutes,
    batchCount: resolveExternalOrderProductionBatchCount(normalizedTotalBroas)
  };
}

export function formatExternalOrderDayKey(date: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const parts = readParts(date, timeZone);
  return `${parts.year}-${`${parts.month}`.padStart(2, '0')}-${`${parts.day}`.padStart(2, '0')}`;
}

export function formatExternalOrderSlotKey(date: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const parts = readParts(date, timeZone);
  return `${formatExternalOrderDayKey(date, timeZone)}T${`${parts.hour}`.padStart(2, '0')}:${`${parts.minute}`.padStart(2, '0')}`;
}

export function resolveExternalOrderSlotStart(date: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(Number.NaN);
  }

  const parts = readParts(parsed, timeZone);
  const roundedMinute = normalizeQuarterMinute(parts.minute);
  const additionalHours = Math.floor(roundedMinute / 60);
  const targetMinute = roundedMinute % 60;
  const localDayAnchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0));
  const normalizedDay = readParts(localDayAnchor, timeZone);

  return zonedDateTimeToUtc(
    {
      year: normalizedDay.year,
      month: normalizedDay.month,
      day: normalizedDay.day,
      hour: parts.hour + additionalHours,
      minute: targetMinute,
      second: 0
    },
    timeZone
  );
}

function resolveNextScheduleDayStart(date: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const parts = readParts(date, timeZone);
  const nextDayAnchor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12, 0, 0, 0));
  const nextDay = readParts(nextDayAnchor, timeZone);
  return zonedDateTimeToUtc(
    {
      year: nextDay.year,
      month: nextDay.month,
      day: nextDay.day,
      hour: EXTERNAL_ORDER_FIRST_SLOT_HOUR,
      minute: EXTERNAL_ORDER_FIRST_SLOT_MINUTE,
      second: 0
    },
    timeZone
  );
}

export function resolveExternalOrderMinimumSchedule(reference = new Date(), timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const zonedReference = readParts(reference, timeZone);
  const dayOffset = zonedReference.hour >= EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR ? 2 : 1;
  const targetCalendarAnchor = new Date(
    Date.UTC(zonedReference.year, zonedReference.month - 1, zonedReference.day + dayOffset, 12, 0, 0, 0)
  );
  const targetCalendar = readParts(targetCalendarAnchor, timeZone);

  return zonedDateTimeToUtc(
    {
      year: targetCalendar.year,
      month: targetCalendar.month,
      day: targetCalendar.day,
      hour: EXTERNAL_ORDER_FIRST_SLOT_HOUR,
      minute: EXTERNAL_ORDER_FIRST_SLOT_MINUTE,
      second: 0
    },
    timeZone
  );
}

export function isExternalOrderScheduleAllowed(
  scheduledAt: Date | null,
  reference = new Date(),
  timeZone = EXTERNAL_ORDER_TIME_ZONE
) {
  if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) return false;
  return scheduledAt.getTime() >= resolveExternalOrderMinimumSchedule(reference, timeZone).getTime();
}

export function formatExternalOrderMinimumSchedule(
  minimum: Date,
  locale = 'pt-BR',
  timeZone = EXTERNAL_ORDER_TIME_ZONE
) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(minimum);
}

export function resolveExternalOrderScheduleAvailability(input: {
  scheduledOrders: ExternalOrderScheduleEntryInput[];
  requestedAt?: Date | string | null;
  requestedTotalBroas?: number | null;
  reference?: Date;
  timeZone?: string;
  dailyLimit?: number;
}) {
  const timeZone = input.timeZone || EXTERNAL_ORDER_TIME_ZONE;
  const dailyLimit =
    Number.isFinite(input.dailyLimit) && Number(input.dailyLimit) > 0
      ? Math.floor(Number(input.dailyLimit))
      : EXTERNAL_ORDER_MAX_ORDERS_PER_DAY;
  const reference = input.reference ?? new Date();
  const minimumAllowedAt = resolveExternalOrderMinimumSchedule(reference, timeZone);

  const dayCounts = new Map<string, number>();
  const occupiedWindows: Array<{ startAt: Date; endAt: Date }> = [];

  for (const value of input.scheduledOrders) {
    if (!value?.scheduledAt) continue;
    const window = resolveExternalOrderProductionWindow(value.scheduledAt, value.totalBroas);
    const parsed = window.scheduledAt;
    if (Number.isNaN(parsed.getTime())) continue;
    const dayKey = formatExternalOrderDayKey(parsed, timeZone);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    if (window.durationMinutes > 0) {
      occupiedWindows.push({
        startAt: window.productionStartAt,
        endAt: window.scheduledAt
      });
    }
  }

  const requestedDate =
    input.requestedAt == null
      ? null
      : input.requestedAt instanceof Date
        ? input.requestedAt
        : new Date(input.requestedAt);
  const requestedAt =
    requestedDate && !Number.isNaN(requestedDate.getTime()) ? resolveExternalOrderSlotStart(requestedDate, timeZone) : null;
  const requestedTotalBroas = normalizeExternalOrderBroaCount(input.requestedTotalBroas);
  const requestedDurationMinutes = resolveExternalOrderProductionDurationMinutes(requestedTotalBroas);

  let reason: ExternalOrderScheduleAvailabilityReason = 'AVAILABLE';
  let requestedAvailable = true;
  let dayOrderCount = 0;
  let slotTaken = false;

  if (requestedAt) {
    const requestedDayKey = formatExternalOrderDayKey(requestedAt, timeZone);
    dayOrderCount = dayCounts.get(requestedDayKey) || 0;
    const requestedStartAt = new Date(requestedAt.getTime() - requestedDurationMinutes * 60_000);
    slotTaken = occupiedWindows.some(
      (window) => requestedStartAt.getTime() < window.endAt.getTime() && requestedAt.getTime() > window.startAt.getTime()
    );

    if (requestedAt.getTime() < minimumAllowedAt.getTime()) {
      reason = 'BEFORE_MINIMUM';
      requestedAvailable = false;
    } else if (dayOrderCount >= dailyLimit) {
      reason = 'DAY_FULL';
      requestedAvailable = false;
    } else if (slotTaken) {
      reason = 'SLOT_TAKEN';
      requestedAvailable = false;
    }
  }

  const startingPoint = requestedAt && requestedAt.getTime() > minimumAllowedAt.getTime() ? requestedAt : minimumAllowedAt;
  let nextAvailableAt = resolveExternalOrderSlotStart(startingPoint, timeZone);

  while (true) {
    const candidateDayKey = formatExternalOrderDayKey(nextAvailableAt, timeZone);
    const candidateDayCount = dayCounts.get(candidateDayKey) || 0;

    if (candidateDayCount >= dailyLimit) {
      nextAvailableAt = resolveNextScheduleDayStart(nextAvailableAt, timeZone);
      continue;
    }

    const candidateStartAt = new Date(nextAvailableAt.getTime() - requestedDurationMinutes * 60_000);
    const overlapsExistingWindow = occupiedWindows.some(
      (window) =>
        candidateStartAt.getTime() < window.endAt.getTime() &&
        nextAvailableAt.getTime() > window.startAt.getTime()
    );

    if (overlapsExistingWindow) {
      nextAvailableAt = new Date(nextAvailableAt.getTime() + EXTERNAL_ORDER_SLOT_MINUTES * 60_000);
      continue;
    }

    break;
  }

  return {
    minimumAllowedAt,
    nextAvailableAt,
    requestedAt,
    requestedAvailable,
    reason,
    dailyLimit,
    requestedTotalBroas,
    requestedDurationMinutes,
    slotMinutes: EXTERNAL_ORDER_SLOT_MINUTES,
    dayOrderCount,
    slotTaken
  };
}
