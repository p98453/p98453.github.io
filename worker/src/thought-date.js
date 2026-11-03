const shanghai = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function shanghaiMinute(date) {
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(shanghai.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// Zone-less times are Shanghai wall time. Store all timestamps in one sortable format.
export function normalizeThoughtDate(value) {
  if (value instanceof Date) return shanghaiMinute(value);
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) return null;
  const [, day, hour, minute, second, zone] = match;
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return null;
  if (hour === undefined) return day;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second || 0) > 59) return null;
  if (!zone) return `${day} ${hour}:${minute}`;
  return shanghaiMinute(new Date(value.replace(' ', 'T')));
}
