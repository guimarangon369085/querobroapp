export const EXTERNAL_ORDER_TIME_ZONE = 'America/Sao_Paulo';
export const EXTERNAL_ORDER_NEXT_DAY_CUTOFF_HOUR = 22;
export const EXTERNAL_ORDER_FIRST_SLOT_HOUR = 8;
export const EXTERNAL_ORDER_FIRST_SLOT_MINUTE = 0;

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
