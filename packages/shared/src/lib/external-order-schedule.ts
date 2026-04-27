export const EXTERNAL_ORDER_TIME_ZONE = 'America/Sao_Paulo';
export const EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR = 22;
export const EXTERNAL_ORDER_FIRST_SLOT_HOUR = 9;
export const EXTERNAL_ORDER_FIRST_SLOT_MINUTE = 0;
export const EXTERNAL_ORDER_SLOT_MINUTES = 15;
export const EXTERNAL_ORDER_MAX_ORDERS_PER_DAY = 15;
export const EXTERNAL_ORDER_OVEN_CAPACITY_BROAS = 14;
export const EXTERNAL_ORDER_OVEN_BATCH_MINUTES = 60;

export const EXTERNAL_ORDER_DELIVERY_WINDOWS = [
  {
    key: 'MORNING',
    label: '9h - 12h',
    startHour: 9,
    startMinute: 0,
    endHour: 12,
    endMinute: 0
  },
  {
    key: 'AFTERNOON',
    label: '12h - 16h',
    startHour: 12,
    startMinute: 0,
    endHour: 16,
    endMinute: 0
  },
  {
    key: 'EVENING',
    label: '16h - 20h',
    startHour: 16,
    startMinute: 0,
    endHour: 20,
    endMinute: 0
  }
] as const;

export type ExternalOrderDeliveryWindowKey = (typeof EXTERNAL_ORDER_DELIVERY_WINDOWS)[number]['key'];

type ExternalOrderScheduleAvailabilityReason =
  | 'AVAILABLE'
  | 'BEFORE_MINIMUM'
  | 'SLOT_TAKEN'
  | 'DAY_FULL'
  | 'DAY_BLOCKED';

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

type CalendarDateParts = Pick<ZonedDateParts, 'year' | 'month' | 'day'>;

type OccupiedWindow = {
  startAt: Date;
  endAt: Date;
};

type BlockedWindowsByDay = Map<string, Set<ExternalOrderDeliveryWindowKey>>;

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

function parseDayKey(value?: string | null): CalendarDateParts | null {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return { year, month, day };
}

function resolveCalendarDateParts(date: Date, timeZone = EXTERNAL_ORDER_TIME_ZONE): CalendarDateParts {
  const parts = readParts(date, timeZone);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day
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

function resolveWindowDateTime(
  dateParts: CalendarDateParts,
  hour: number,
  minute: number,
  timeZone = EXTERNAL_ORDER_TIME_ZONE
) {
  return zonedDateTimeToUtc(
    {
      year: dateParts.year,
      month: dateParts.month,
      day: dateParts.day,
      hour,
      minute,
      second: 0
    },
    timeZone
  );
}

function resolveWindowRange(
  dateParts: CalendarDateParts,
  windowKey: ExternalOrderDeliveryWindowKey,
  timeZone = EXTERNAL_ORDER_TIME_ZONE
) {
  const windowIndex = EXTERNAL_ORDER_DELIVERY_WINDOWS.findIndex((entry) => entry.key === windowKey);
  const window = windowIndex >= 0 ? EXTERNAL_ORDER_DELIVERY_WINDOWS[windowIndex] : null;
  if (!window) {
    return null;
  }

  return {
    ...window,
    endInclusive: windowIndex === EXTERNAL_ORDER_DELIVERY_WINDOWS.length - 1,
    startAt: resolveWindowDateTime(dateParts, window.startHour, window.startMinute, timeZone),
    endAt: resolveWindowDateTime(dateParts, window.endHour, window.endMinute, timeZone)
  };
}

function overlapsWindow(candidateStartAt: Date, candidateEndAt: Date, occupiedWindows: OccupiedWindow[]) {
  return occupiedWindows.some(
    (window) =>
      candidateStartAt.getTime() < window.endAt.getTime() &&
      candidateEndAt.getTime() > window.startAt.getTime()
  );
}

function findFirstAvailableAtWithinRange(input: {
  rangeStartAt: Date;
  rangeEndAt: Date;
  rangeEndInclusive?: boolean;
  minimumAllowedAt: Date;
  requestedDurationMinutes: number;
  occupiedWindows: OccupiedWindow[];
  dayOrderCount: number;
  dailyLimit: number;
  blocked: boolean;
  timeZone: string;
}) {
  if (input.blocked) return null;
  if (input.dayOrderCount >= input.dailyLimit) return null;

  const initialStart =
    input.rangeStartAt.getTime() > input.minimumAllowedAt.getTime() ? input.rangeStartAt : input.minimumAllowedAt;
  let candidateAt = resolveExternalOrderSlotStart(initialStart, input.timeZone);
  const isWithinRange = (candidate: Date) =>
    input.rangeEndInclusive ? candidate.getTime() <= input.rangeEndAt.getTime() : candidate.getTime() < input.rangeEndAt.getTime();

  while (isWithinRange(candidateAt)) {
    const candidateStartAt = new Date(candidateAt.getTime() - input.requestedDurationMinutes * 60_000);
    if (!overlapsWindow(candidateStartAt, candidateAt, input.occupiedWindows)) {
      return candidateAt;
    }
    candidateAt = new Date(candidateAt.getTime() + EXTERNAL_ORDER_SLOT_MINUTES * 60_000);
  }

  return null;
}

function findNextAvailableAtFrom(input: {
  startingPoint: Date;
  minimumAllowedAt: Date;
  requestedDurationMinutes: number;
  occupiedWindows: OccupiedWindow[];
  dayCounts: Map<string, number>;
  blockedDayKeys?: Set<string>;
  blockedWindowsByDay?: BlockedWindowsByDay;
  dailyLimit: number;
  timeZone: string;
}) {
  let nextAvailableAt = resolveExternalOrderSlotStart(
    input.startingPoint.getTime() > input.minimumAllowedAt.getTime() ? input.startingPoint : input.minimumAllowedAt,
    input.timeZone
  );

  while (true) {
    const candidateDayKey = formatExternalOrderDayKey(nextAvailableAt, input.timeZone);
    const candidateWindowKey = resolveExternalOrderDeliveryWindowKeyForDate(nextAvailableAt, input.timeZone);
    const blockedWindows = input.blockedWindowsByDay?.get(candidateDayKey);
    const dayFullyBlocked =
      input.blockedDayKeys?.has(candidateDayKey) ||
      (blockedWindows?.size ?? 0) >= EXTERNAL_ORDER_DELIVERY_WINDOWS.length;

    if (dayFullyBlocked) {
      nextAvailableAt = resolveNextScheduleDayStart(nextAvailableAt, input.timeZone);
      continue;
    }

    if (candidateWindowKey && blockedWindows?.has(candidateWindowKey)) {
      nextAvailableAt = new Date(nextAvailableAt.getTime() + EXTERNAL_ORDER_SLOT_MINUTES * 60_000);
      continue;
    }

    const candidateDayCount = input.dayCounts.get(candidateDayKey) || 0;

    if (candidateDayCount >= input.dailyLimit) {
      nextAvailableAt = resolveNextScheduleDayStart(nextAvailableAt, input.timeZone);
      continue;
    }

    const candidateStartAt = new Date(nextAvailableAt.getTime() - input.requestedDurationMinutes * 60_000);
    if (overlapsWindow(candidateStartAt, nextAvailableAt, input.occupiedWindows)) {
      nextAvailableAt = new Date(nextAvailableAt.getTime() + EXTERNAL_ORDER_SLOT_MINUTES * 60_000);
      continue;
    }

    return nextAvailableAt;
  }
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

export function resolveExternalOrderDeliveryWindowLabel(windowKey?: string | null) {
  return EXTERNAL_ORDER_DELIVERY_WINDOWS.find((entry) => entry.key === windowKey)?.label ?? null;
}

export function resolveExternalOrderDeliveryWindowKeyForDate(date?: Date | string | null, timeZone = EXTERNAL_ORDER_TIME_ZONE) {
  const parsed = date instanceof Date ? new Date(date) : new Date(date ?? Number.NaN);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = readParts(parsed, timeZone);
  const minutes = parts.hour * 60 + parts.minute;

  for (const [index, window] of EXTERNAL_ORDER_DELIVERY_WINDOWS.entries()) {
    const startMinutes = window.startHour * 60 + window.startMinute;
    const endMinutes = window.endHour * 60 + window.endMinute;
    const withinRange =
      minutes >= startMinutes &&
      (index === EXTERNAL_ORDER_DELIVERY_WINDOWS.length - 1 ? minutes <= endMinutes : minutes < endMinutes);
    if (withinRange) {
      return window.key;
    }
  }

  return null;
}

export function resolveExternalOrderScheduleAvailability(input: {
  scheduledOrders: ExternalOrderScheduleEntryInput[];
  requestedAt?: Date | string | null;
  requestedDate?: string | null;
  requestedWindowKey?: ExternalOrderDeliveryWindowKey | string | null;
  requestedTotalBroas?: number | null;
  blockedDayKeys?: Iterable<string> | null;
  blockedWindows?:
    | Iterable<{ dayKey: string; windowKey: ExternalOrderDeliveryWindowKey | string | null | undefined }>
    | null;
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
  const occupiedWindows: OccupiedWindow[] = [];
  const blockedDayKeys = new Set(
    Array.from(input.blockedDayKeys || [])
      .map((value) => parseDayKey(value))
      .filter((value): value is CalendarDateParts => Boolean(value))
      .map((value) => `${value.year}-${`${value.month}`.padStart(2, '0')}-${`${value.day}`.padStart(2, '0')}`),
  );
  const blockedWindowsByDay: BlockedWindowsByDay = new Map();

  for (const entry of input.blockedWindows || []) {
    const normalizedDay = parseDayKey(entry?.dayKey);
    const parsedWindowKey = EXTERNAL_ORDER_DELIVERY_WINDOWS.some((window) => window.key === entry?.windowKey)
      ? (entry?.windowKey as ExternalOrderDeliveryWindowKey)
      : null;
    if (!normalizedDay || !parsedWindowKey) continue;
    const dayKey = `${normalizedDay.year}-${`${normalizedDay.month}`.padStart(2, '0')}-${`${normalizedDay.day}`.padStart(2, '0')}`;
    const bucket = blockedWindowsByDay.get(dayKey) || new Set<ExternalOrderDeliveryWindowKey>();
    bucket.add(parsedWindowKey);
    blockedWindowsByDay.set(dayKey, bucket);
  }

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
    const requestedWindowKeyAt = resolveExternalOrderDeliveryWindowKeyForDate(requestedAt, timeZone);
    const blockedWindows = blockedWindowsByDay.get(requestedDayKey);
    const requestedDayFullyBlocked =
      blockedDayKeys.has(requestedDayKey) ||
      (blockedWindows?.size ?? 0) >= EXTERNAL_ORDER_DELIVERY_WINDOWS.length;
    dayOrderCount = dayCounts.get(requestedDayKey) || 0;
    const requestedStartAt = new Date(requestedAt.getTime() - requestedDurationMinutes * 60_000);
    slotTaken = overlapsWindow(requestedStartAt, requestedAt, occupiedWindows);

    if (requestedAt.getTime() < minimumAllowedAt.getTime()) {
      reason = 'BEFORE_MINIMUM';
      requestedAvailable = false;
    } else if (requestedDayFullyBlocked || (requestedWindowKeyAt && blockedWindows?.has(requestedWindowKeyAt))) {
      reason = 'DAY_BLOCKED';
      requestedAvailable = false;
    } else if (dayOrderCount >= dailyLimit) {
      reason = 'DAY_FULL';
      requestedAvailable = false;
    } else if (slotTaken) {
      reason = 'SLOT_TAKEN';
      requestedAvailable = false;
    }
  }

  const nextAvailableAt = findNextAvailableAtFrom({
    startingPoint: requestedAt && requestedAt.getTime() > minimumAllowedAt.getTime() ? requestedAt : minimumAllowedAt,
    minimumAllowedAt,
    requestedDurationMinutes,
    occupiedWindows,
    dayCounts,
    blockedDayKeys,
    blockedWindowsByDay,
    dailyLimit,
    timeZone
  });

  const requestedCalendarDateParts =
    parseDayKey(input.requestedDate) ??
    (requestedAt ? resolveCalendarDateParts(requestedAt, timeZone) : resolveCalendarDateParts(nextAvailableAt, timeZone));
  const requestedDateKey = `${requestedCalendarDateParts.year}-${`${requestedCalendarDateParts.month}`.padStart(2, '0')}-${`${requestedCalendarDateParts.day}`.padStart(2, '0')}`;
  const requestedWindowKey = EXTERNAL_ORDER_DELIVERY_WINDOWS.some((entry) => entry.key === input.requestedWindowKey)
    ? (input.requestedWindowKey as ExternalOrderDeliveryWindowKey)
    : null;
  const requestedDateDayCount = dayCounts.get(requestedDateKey) || dayOrderCount;
  const requestedDateBlockedWindows = blockedWindowsByDay.get(requestedDateKey);
  const requestedDateBlocked =
    blockedDayKeys.has(requestedDateKey) ||
    (requestedDateBlockedWindows?.size ?? 0) >= EXTERNAL_ORDER_DELIVERY_WINDOWS.length;

  const windows = EXTERNAL_ORDER_DELIVERY_WINDOWS.map((window) => {
    const range = resolveWindowRange(requestedCalendarDateParts, window.key, timeZone);
    if (!range) {
      return {
        key: window.key,
        label: window.label,
        startLabel: `${window.startHour}h`,
        endLabel: `${window.endHour}h`,
        available: false,
        scheduledAt: null,
        reason: 'SLOT_TAKEN' as ExternalOrderScheduleAvailabilityReason
      };
    }

    const availableAt = findFirstAvailableAtWithinRange({
      rangeStartAt: range.startAt,
      rangeEndAt: range.endAt,
      rangeEndInclusive: range.endInclusive,
      minimumAllowedAt,
      requestedDurationMinutes,
      occupiedWindows,
      dayOrderCount: requestedDateBlocked ? dailyLimit : requestedDateDayCount,
      dailyLimit,
      blocked: requestedDateBlocked || Boolean(requestedDateBlockedWindows?.has(window.key)),
      timeZone
    });

    const windowFinishedBeforeMinimum = range.endInclusive
      ? range.endAt.getTime() < minimumAllowedAt.getTime()
      : range.endAt.getTime() <= minimumAllowedAt.getTime();
    const windowBlocked = requestedDateBlocked || Boolean(requestedDateBlockedWindows?.has(window.key));
    const windowReason: ExternalOrderScheduleAvailabilityReason =
      availableAt
        ? 'AVAILABLE'
        : windowBlocked
          ? 'DAY_BLOCKED'
        : requestedDateDayCount >= dailyLimit
          ? 'DAY_FULL'
          : windowFinishedBeforeMinimum
            ? 'BEFORE_MINIMUM'
            : 'SLOT_TAKEN';

    return {
      key: window.key,
      label: window.label,
      startLabel: `${window.startHour}h`,
      endLabel: `${window.endHour}h`,
      available: Boolean(availableAt),
      scheduledAt: availableAt,
      reason: windowReason
    };
  });

  const requestedWindow = requestedWindowKey ? windows.find((entry) => entry.key === requestedWindowKey) ?? null : null;
  const requestedWindowStartAt = requestedWindowKey
    ? resolveWindowRange(requestedCalendarDateParts, requestedWindowKey, timeZone)?.startAt ?? null
    : null;
  const requestedWindowNextAvailableAt =
    requestedWindowStartAt == null
      ? null
      : findNextAvailableAtFrom({
          startingPoint: requestedWindowStartAt,
          minimumAllowedAt,
          requestedDurationMinutes,
          occupiedWindows,
          dayCounts,
          blockedDayKeys,
          blockedWindowsByDay,
          dailyLimit,
          timeZone
        });

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
    dayOrderCount: requestedAt ? dayOrderCount : requestedDateDayCount,
    slotTaken,
    requestedDate: requestedDateKey,
    requestedWindowKey,
    requestedWindowLabel: requestedWindow?.label ?? null,
    requestedWindowAvailable: requestedWindow?.available ?? false,
    requestedWindowReason: requestedWindow?.reason ?? null,
    requestedWindowScheduledAt: requestedWindow?.scheduledAt ?? null,
    requestedWindowNextAvailableAt,
    windows
  };
}
