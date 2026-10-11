import ICAL from 'ical.js';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_EVENTS = 20;

type CalendarTime = InstanceType<typeof ICAL.Time>;
type CalendarEvent = InstanceType<typeof ICAL.Event>;

interface CalendarEntry {
  title: string;
  start: number;
  allDay: boolean;
}

function dayStart(dateStr: string): number {
  return Date.parse(dateStr + 'T00:00:00Z') - TAIPEI_OFFSET_MS;
}

function timestamp(time: CalendarTime): number {
  if (time.isDate) {
    return Date.UTC(time.year, time.month - 1, time.day) - TAIPEI_OFFSET_MS;
  }
  return time.toJSDate().getTime();
}

function clock(ms: number): string {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

function safeTitle(title: string): string {
  // The digest uses Telegram's legacy Markdown parser.
  return title.replace(/[\r\n]+/g, ' ').slice(0, 100).replace(/([_*\x60\[\\])/g, '\\$1');
}

export function formatTodayCalendar(ics: string, dateStr: string): string {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  for (const timezone of calendar.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(timezone);
  }

  const masters = new Map<string, CalendarEvent>();
  const exceptions: CalendarEvent[] = [];
  for (const component of calendar.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) exceptions.push(event);
    else masters.set(event.uid, event);
  }
  for (const exception of exceptions) {
    masters.get(exception.uid)?.relateException(exception);
  }

  const start = dayStart(dateStr);
  const end = start + 24 * 60 * 60 * 1000;
  const entries: CalendarEntry[] = [];
  const seen = new Set<string>();
  const add = (event: CalendarEvent, from: CalendarTime, to: CalendarTime) => {
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const fromMs = timestamp(from);
    const toMs = timestamp(to);
    const key = event.uid + '|' + fromMs + '|' + toMs + '|' + event.summary;
    if (fromMs < end && toMs > start && !seen.has(key)) {
      seen.add(key);
      entries.push({ title: event.summary || '(未命名行程)', start: fromMs, allDay: from.isDate });
    }
  };

  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    for (let count = 0; count < 20000; count++) {
      const occurrence = iterator.next();
      if (!occurrence) break;
      const details = event.getOccurrenceDetails(occurrence);
      add(details.item, details.startDate, details.endDate);
      if (timestamp(occurrence) >= end) break;
    }
  }
  for (const exception of exceptions) {
    if (!masters.has(exception.uid)) add(exception, exception.startDate, exception.endDate);
  }

  entries.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  if (!entries.length) return '📅 今日行程\n沒有行程';
  const lines = entries.slice(0, MAX_EVENTS).map(entry => {
    const time = entry.allDay ? '全天' : clock(entry.start);
    return '• ' + time + ' ' + safeTitle(entry.title);
  });
  if (entries.length > MAX_EVENTS) lines.push('另有 ' + (entries.length - MAX_EVENTS) + ' 筆行程');
  return '📅 今日行程\n' + lines.join('\n');
}

export async function getTodayCalendar(url: string, dateStr: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Calendar URL must use HTTPS');
  const response = await fetch(parsed.toString(), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Calendar HTTP ' + response.status);
  if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('Calendar feed too large');
  const ics = await response.text();
  if (ics.length > 2_000_000) throw new Error('Calendar feed too large');
  return formatTodayCalendar(ics, dateStr);
}
