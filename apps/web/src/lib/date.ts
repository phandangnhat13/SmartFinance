function partsInTimeZone(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

export function todayInTimeZone(timeZone: string): string {
  const parts = partsInTimeZone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentMonthRange(timeZone: string): {
  from: string;
  to: string;
  month: string;
} {
  const today = todayInTimeZone(timeZone);
  const [year, month] = today.split('-');
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    month: `${year}-${month}`,
  };
}

export function lastMonthsRange(timeZone: string, count: number): { from: string; to: string } {
  const today = todayInTimeZone(timeZone);
  const [year, month] = today.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - count, 1));
  const from = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
  return { from, to: today };
}

/** Converts a datetime-local value wall-clock time in `timeZone` to ISO UTC. */
export function inputToIso(value: string, timeZone: string): string {
  const [datePart, timePart = '00:00'] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guessDate = new Date(guess);
  const parts = partsInTimeZone(guessDate, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = asUtc - guess;
  return new Date(guess - offset).toISOString();
}

/** Renders an ISO instant as a datetime-local string in `timeZone`. */
export function isoToInput(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsInTimeZone(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function nowInput(timeZone: string): string {
  return isoToInput(new Date().toISOString(), timeZone);
}
