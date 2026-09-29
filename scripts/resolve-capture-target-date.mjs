const TIME_ZONE = 'Asia/Taipei';
const DEFAULT_CLOSE_READY_HOUR = 18;

function taipeiParts(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') };
}

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function resolveCaptureTargetDate({ now = new Date(), closeReadyHour = DEFAULT_CLOSE_READY_HOUR } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('now must be a valid Date');
  if (!Number.isInteger(closeReadyHour) || closeReadyHour < 0 || closeReadyHour > 23) {
    throw new Error('closeReadyHour must be an integer from 0 to 23');
  }

  const local = taipeiParts(now);
  const candidate = new Date(Date.UTC(local.year, local.month - 1, local.day));

  // A delayed evening schedule may start after local midnight. Before the
  // after-close readiness hour, anchor it to the preceding market weekday.
  if (local.hour < closeReadyHour) candidate.setUTCDate(candidate.getUTCDate() - 1);

  // Exchange holidays are confirmed by the official Gate. Weekend dates can
  // be rejected deterministically here without pretending to know holidays.
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }

  return formatUtcDate(candidate);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const explicitNow = process.argv[2] ? new Date(process.argv[2]) : new Date();
  process.stdout.write(`${resolveCaptureTargetDate({ now: explicitNow })}\n`);
}
