const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export type TimeRole = 'reminder' | 'deadline';

export type TimeIntentResult =
  | {
      status: 'resolved';
      instant: string;
      role: TimeRole;
      precision: 'exact' | 'default';
    }
  | { status: 'ambiguous'; reason: string }
  | { status: 'none' };

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

interface ClockTime {
  hour: number;
  minute: number;
  precision: 'exact' | 'default';
}

interface DateSpec {
  date: LocalDate;
  rollover: 'none' | 'day' | 'week' | 'year' | 'month-end';
}

const NUMBER_TOKEN = '[0-9零〇一二兩三四五六七八九十百]{1,5}';
const PERIOD = '凌晨|早上|早晨|上午|中午|午間|下午|傍晚|黃昏|晚上|晚間|夜裡|夜晚|深夜';
const VAGUE_TIME = /(待會|等一下|等等|晚點|稍後|改天)/;

/**
 * Deterministically resolves Traditional Chinese time expressions in Asia/Taipei.
 * AI output is deliberately not part of this interface.
 */
export function parseTimeIntent(text: string, referenceIso: string): TimeIntentResult {
  const reference = new Date(referenceIso);
  if (Number.isNaN(reference.getTime())) {
    return { status: 'ambiguous', reason: '訊息基準時間無效' };
  }

  const role = parseRole(text);
  const relativeDuration = parseRelativeDuration(text);
  if (relativeDuration !== null) {
    return {
      status: 'resolved',
      instant: new Date(reference.getTime() + relativeDuration).toISOString(),
      role,
      precision: 'exact',
    };
  }

  const today = taipeiDateFromInstant(reference);
  const clock = parseClock(text);
  const dateSpec = parseDate(text, today);

  if (!dateSpec && hasIncompleteDateSignal(text)) {
    return { status: 'ambiguous', reason: '日期描述不完整' };
  }

  if (!clock && !dateSpec) {
    const vague = text.match(VAGUE_TIME)?.[1];
    if (vague) return { status: 'ambiguous', reason: `「${vague}」沒有明確時間` };
    if (hasUnsupportedTemporalSignal(text)) {
      return { status: 'ambiguous', reason: '時間描述不夠明確' };
    }
    return { status: 'none' };
  }

  const selectedClock = clock ?? { hour: 8, minute: 0, precision: 'default' as const };
  const selectedDate = dateSpec ?? { date: today, rollover: 'day' as const };
  let instant = toInstant(selectedDate.date, selectedClock);
  if (!instant) return { status: 'ambiguous', reason: '日期或時間不存在' };

  if (instant.getTime() <= reference.getTime()) {
    switch (selectedDate.rollover) {
      case 'day':
        instant = toInstant(addDays(selectedDate.date, 1), selectedClock)!;
        break;
      case 'week':
        instant = toInstant(addDays(selectedDate.date, 7), selectedClock)!;
        break;
      case 'year': {
        const nextYear = { ...selectedDate.date, year: selectedDate.date.year + 1 };
        instant = toInstant(nextYear, selectedClock);
        if (!instant) return { status: 'ambiguous', reason: '日期或時間不存在' };
        break;
      }
      case 'month-end': {
        const next = addMonths({ ...selectedDate.date, day: 1 }, 1);
        next.day = daysInMonth(next.year, next.month);
        instant = toInstant(next, selectedClock)!;
        break;
      }
      case 'none':
        return { status: 'ambiguous', reason: '指定時間已經過去' };
    }
  }

  return {
    status: 'resolved',
    instant: instant.toISOString(),
    role,
    precision: selectedClock.precision,
  };
}

function parseRole(text: string): TimeRole {
  return /(之前|以前|截止|期限|最晚|(?:點|时|時|分|日|號|号|天)\s*前)/.test(text)
    ? 'deadline'
    : 'reminder';
}

function parseRelativeDuration(text: string): number | null {
  if (/半\s*(?:個)?\s*(?:小時|鐘頭)(?:之)?後/.test(text)) return 30 * 60 * 1000;

  const hourAndHalf = text.match(new RegExp(`(${NUMBER_TOKEN})\\s*(?:個)?半\\s*(?:小時|鐘頭)(?:之)?後`));
  if (hourAndHalf) {
    const amount = parseNumber(hourAndHalf[1]);
    return amount === null ? null : (amount * 60 + 30) * 60 * 1000;
  }

  const relative = text.match(new RegExp(`(${NUMBER_TOKEN})\\s*(?:個)?\\s*(分鐘|分|小時|鐘頭)(?:之)?後`));
  if (!relative) return null;
  const amount = parseNumber(relative[1]);
  if (amount === null) return null;
  return amount * (relative[2] === '分鐘' || relative[2] === '分' ? 60_000 : 3_600_000);
}

function parseDate(text: string, today: LocalDate): DateSpec | null {
  const fullDate = text.match(/(\d{4})\s*(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})\s*(?:日|號)?/);
  if (fullDate) {
    const date = { year: Number(fullDate[1]), month: Number(fullDate[2]), day: Number(fullDate[3]) };
    return validDate(date) ? { date, rollover: 'none' } : { date, rollover: 'none' };
  }

  const namedYearDate = text.match(/(明年|今年)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|號)?/);
  if (namedYearDate) {
    return {
      date: {
        year: today.year + (namedYearDate[1] === '明年' ? 1 : 0),
        month: Number(namedYearDate[2]),
        day: Number(namedYearDate[3]),
      },
      rollover: 'none',
    };
  }

  const monthDay = text.match(/(\d{1,2})\s*(?:月|\/)\s*(\d{1,2})\s*(?:日|號)?/);
  if (monthDay) {
    return {
      date: { year: today.year, month: Number(monthDay[1]), day: Number(monthDay[2]) },
      rollover: 'year',
    };
  }

  const nextMonthDay = text.match(new RegExp(`下個月\\s*(${NUMBER_TOKEN})\\s*(?:日|號)`));
  if (nextMonthDay) {
    const day = parseNumber(nextMonthDay[1]);
    if (day !== null) {
      const date = addMonths({ ...today, day: 1 }, 1);
      date.day = day;
      return { date, rollover: 'none' };
    }
  }

  if (/下個月月底|下月底/.test(text)) {
    const date = addMonths({ ...today, day: 1 }, 1);
    date.day = daysInMonth(date.year, date.month);
    return { date, rollover: 'none' };
  }
  if (/月底/.test(text)) {
    return {
      date: { ...today, day: daysInMonth(today.year, today.month) },
      rollover: 'month-end',
    };
  }

  if (/明年(?:底|年底)/.test(text)) {
    return { date: { year: today.year + 1, month: 12, day: 31 }, rollover: 'none' };
  }
  if (/年底/.test(text)) {
    return { date: { year: today.year, month: 12, day: 31 }, rollover: 'year' };
  }

  if (/大後天/.test(text)) return { date: addDays(today, 3), rollover: 'none' };
  if (/後天/.test(text)) return { date: addDays(today, 2), rollover: 'none' };
  if (/明天|明日|明早|明晨|明晚/.test(text)) return { date: addDays(today, 1), rollover: 'none' };
  if (/今天|今日|今早|今晚/.test(text)) return { date: today, rollover: 'none' };

  const daysLater = text.match(new RegExp(`(${NUMBER_TOKEN})\\s*天(?:之)?後`));
  if (daysLater) {
    const days = parseNumber(daysLater[1]);
    if (days !== null) return { date: addDays(today, days), rollover: 'none' };
  }

  const weekday = text.match(/(?:(下下|下|這|本)?(?:週|周|星期|禮拜))([一二三四五六日天])/);
  if (weekday) {
    const target = weekdayNumber(weekday[2]);
    const current = weekdayIndex(today);
    const prefix = weekday[1];
    if (prefix === '下下' || prefix === '下' || prefix === '這' || prefix === '本') {
      const weekOffset = prefix === '下下' ? 2 : prefix === '下' ? 1 : 0;
      const monday = addDays(today, -current);
      return { date: addDays(monday, weekOffset * 7 + target), rollover: 'none' };
    }
    const delta = (target - current + 7) % 7;
    return { date: addDays(today, delta), rollover: 'week' };
  }

  return null;
}

function parseClock(text: string): ClockTime | null {
  const colon = text.match(new RegExp(`(?:(${PERIOD})\\s*)?([01]?\\d|2[0-3])\\s*[:：]\\s*([0-5]?\\d)(?!\\d)`));
  if (colon) {
    return {
      hour: applyPeriod(Number(colon[2]), colon[1]),
      minute: Number(colon[3]),
      precision: 'exact',
    };
  }

  const point = text.match(new RegExp(`(?:(${PERIOD})\\s*)?(${NUMBER_TOKEN})\\s*[點点時时](?:\\s*(半|一刻|三刻)|\\s*(${NUMBER_TOKEN})\\s*分?)?`));
  if (point) {
    const rawHour = parseNumber(point[2]);
    if (rawHour === null || rawHour > 23) return null;
    let minute = 0;
    if (point[3] === '半') minute = 30;
    else if (point[3] === '一刻') minute = 15;
    else if (point[3] === '三刻') minute = 45;
    else if (point[4]) minute = parseNumber(point[4]) ?? -1;
    if (minute < 0 || minute > 59) return null;
    return { hour: applyPeriod(rawHour, point[1]), minute, precision: 'exact' };
  }

  const words: Array<[string, number]> = [
    ['凌晨', 1], ['明早', 8], ['明晨', 8], ['今早', 8],
    ['早上', 8], ['早晨', 8], ['上午', 8], ['中午', 12], ['午間', 12],
    ['下午', 15], ['傍晚', 18], ['黃昏', 18], ['明晚', 20], ['今晚', 20],
    ['晚上', 20], ['晚間', 20], ['夜裡', 20], ['夜晚', 20], ['睡前', 23], ['深夜', 23],
  ];
  for (const [word, hour] of words) {
    if (text.includes(word)) return { hour, minute: 0, precision: 'default' };
  }
  return null;
}

function parseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (value === '十') return 10;
  if (value === '百') return 100;

  let total = 0;
  let pending = 0;
  for (const char of value) {
    if (char in digits) {
      pending = digits[char];
    } else if (char === '十') {
      total += (pending || 1) * 10;
      pending = 0;
    } else if (char === '百') {
      total += (pending || 1) * 100;
      pending = 0;
    } else {
      return null;
    }
  }
  return total + pending;
}

function applyPeriod(hour: number, period: string | undefined): number {
  if (!period) return hour;
  if (/下午|傍晚|黃昏|晚上|晚間|夜裡|夜晚|深夜/.test(period) && hour < 12) return hour + 12;
  if (/中午|午間/.test(period) && hour < 11) return hour + 12;
  if (period === '凌晨' && hour === 12) return 0;
  return hour;
}

function taipeiDateFromInstant(instant: Date): LocalDate {
  const local = new Date(instant.getTime() + TAIPEI_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

function toInstant(date: LocalDate, clock: Pick<ClockTime, 'hour' | 'minute'>): Date | null {
  if (!validDate(date) || clock.hour < 0 || clock.hour > 23 || clock.minute < 0 || clock.minute > 59) return null;
  return new Date(Date.UTC(date.year, date.month - 1, date.day, clock.hour, clock.minute) - TAIPEI_OFFSET_MS);
}

function validDate(date: LocalDate): boolean {
  return date.month >= 1 && date.month <= 12 && date.day >= 1 && date.day <= daysInMonth(date.year, date.month);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function addMonths(date: LocalDate, months: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: date.day };
}

function weekdayIndex(date: LocalDate): number {
  const sundayBased = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return (sundayBased + 6) % 7;
}

function weekdayNumber(value: string): number {
  return ({ 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 })[value] ?? 0;
}

function hasUnsupportedTemporalSignal(text: string): boolean {
  return /(時間|日期|提醒|下個月|月底|年後|個月後)/.test(text);
}

function hasIncompleteDateSignal(text: string): boolean {
  return /(下下週|下週|下周|這週|這周|本週|本周|下個月|明年|今年|年初|(?:週|周|星期|禮拜)(?![一二三四五六日天]))/u.test(text);
}
