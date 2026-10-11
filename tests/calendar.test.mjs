import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTodayCalendar } from '../src/calendar.ts';

const feed = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:all-day',
  'DTSTART;VALUE=DATE:20261011',
  'DTEND;VALUE=DATE:20261012',
  'SUMMARY:休假',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:meeting',
  'DTSTART:20261011T010000Z',
  'DTEND:20261011T020000Z',
  'SUMMARY:開會',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:repeat',
  'DTSTART:20261009T000000Z',
  'DTEND:20261009T003000Z',
  'RRULE:FREQ=DAILY;COUNT=4',
  'EXDATE:20261010T000000Z',
  'SUMMARY:晨會',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:tomorrow',
  'DTSTART:20261011T170000Z',
  'DTEND:20261011T180000Z',
  'SUMMARY:明天的事',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:moved',
  'DTSTART:20261012T020000Z',
  'DTEND:20261012T030000Z',
  'RRULE:FREQ=DAILY;COUNT=2',
  'SUMMARY:原訂明天',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:moved',
  'RECURRENCE-ID:20261012T020000Z',
  'DTSTART:20261011T040000Z',
  'DTEND:20261011T050000Z',
  'SUMMARY:改到今天',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('formats only today in Taipei, including all-day and recurring events', () => {
  const result = formatTodayCalendar(feed, '2026-10-11');
  assert.match(result, /全天 休假/);
  assert.match(result, /08:00 晨會/);
  assert.match(result, /09:00 開會/);
  assert.match(result, /12:00 改到今天/);
  assert.doesNotMatch(result, /明天的事/);
});

test('empty day is explicit', () => {
  assert.equal(formatTodayCalendar(feed, '2026-10-14'), '📅 今日行程\n沒有行程');
});
