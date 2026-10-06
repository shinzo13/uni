const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function isoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatDay(value: string | Date) {
  return WEEKDAY.format(new Date(value));
}

export function formatShortDate(value: string | Date) {
  return SHORT_DATE.format(new Date(value));
}

export function formatDateTime(value: string) {
  return DATE_TIME.format(new Date(value));
}

export function formatTime(value: string) {
  return TIME.format(new Date(value));
}

export function relativeDue(value: string, now = new Date()) {
  const hours = (new Date(value).getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) {
    return 'overdue';
  }
  if (hours < 24) {
    return `in ${Math.max(1, Math.round(hours))} h`;
  }
  return `in ${Math.round(hours / 24)} d`;
}

export function plainText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

export function currentTerm(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 10) {
    return { year, code: `${year}/SZ`, academic: `${year}/${String(year + 1).slice(2)}` };
  }
  if (month <= 2) {
    return { year: year - 1, code: `${year - 1}/SZ`, academic: `${year - 1}/${String(year).slice(2)}` };
  }
  return { year: year - 1, code: `${year}/SL`, academic: `${year - 1}/${String(year).slice(2)}` };
}
