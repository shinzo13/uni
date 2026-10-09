const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' });
const FULL_DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
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
  return SHORT_DATE.format(new Date(value)).replace(/\//g, '.');
}

export function formatFullDate(value: string | Date) {
  return FULL_DATE.format(new Date(value)).replace(/\//g, '.');
}

export function formatDateTime(value: string) {
  return DATE_TIME.format(new Date(value)).replace(/\//g, '.');
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

export function termOf(name: string) {
  const short = name.match(/\b(\d{4})\/(SZ|SL)\b/);
  if (short) {
    return `${short[1]}/${short[2]}`;
  }
  const academic = name.match(/\b(\d{4})\/(\d{2})\s*(SZ|SL)\b/);
  if (academic) {
    return academic[3] === 'SZ' ? `${academic[1]}/SZ` : `${Number(academic[1]) + 1}/SL`;
  }
  return null;
}

export function termLabel(code: string | null) {
  const match = code?.match(/^(\d{4})\/(SZ|SL)$/);
  if (!match) {
    return 'Other';
  }
  const year = Number(match[1]);
  return match[2] === 'SZ'
    ? `Winter ${year}/${String(year + 1).slice(2)}`
    : `Summer ${year - 1}/${String(year).slice(2)}`;
}

const TEAMS_PREFIX = /^\d{4}\/(SZ|SL)\s+\S+\s+(?:([A-Z]{2,4})\s+)?/;

export function courseTitle(name: string) {
  return name
    .replace(TEAMS_PREFIX, '')
    .replace(/\s+-\s+(Grupa\s+)?\d+$/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
}

export function courseDetail(name: string) {
  const kind = name.match(TEAMS_PREFIX)?.[2];
  if (kind) {
    return kind;
  }
  const details = [...name.matchAll(/\(([^)]*)\)/g)].map((match) => match[1].trim());
  return details.find((detail) => detail && !/\d{4}/.test(detail) && !/^[A-ZŁŚŻ]\.\s/.test(detail)) ?? null;
}

type LinkSegment = { text: string; url?: string };

const ANCHOR = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
const TOKENS = /\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003|(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)])/g;

export function linkSegments(html: string): LinkSegment[] {
  const marked = html.replace(
    ANCHOR,
    (_, href: string, label: string) => `\u0001${href.replace(/&amp;/g, '&')}\u0002${plainText(label) || href}\u0003`,
  );
  const body = plainText(marked);
  const result: LinkSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKENS)) {
    if (match.index > last) {
      result.push({ text: body.slice(last, match.index) });
    }
    result.push(match[3] ? { text: match[3], url: match[3] } : { text: match[2], url: match[1] });
    last = match.index + match[0].length;
  }
  if (last < body.length) {
    result.push({ text: body.slice(last) });
  }
  return result;
}
