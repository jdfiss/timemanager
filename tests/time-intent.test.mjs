import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTimeIntent } from '../src/time-intent.ts';

// 2026-09-19 (Saturday) 10:00 Asia/Taipei
const REFERENCE = '2026-09-19T02:00:00.000Z';

const resolved = (text) => {
  const result = parseTimeIntent(text, REFERENCE);
  assert.equal(result.status, 'resolved', `${text}: ${JSON.stringify(result)}`);
  return result;
};

test('parses the three reported failures without model output', () => {
  assert.equal(resolved('中午出題').instant, '2026-09-19T04:00:00.000Z');
  assert.equal(resolved('13:00出題').instant, '2026-09-19T05:00:00.000Z');
  assert.equal(resolved('今日下午一點之前 出題').instant, '2026-09-19T05:00:00.000Z');
});

test('parses weekdays using calendar-week semantics', () => {
  assert.equal(resolved('下週三下午三點出題').instant, '2026-09-23T07:00:00.000Z');
  assert.equal(resolved('週五早上出題').instant, '2026-09-25T00:00:00.000Z');
});

test('parses relative durations from the message timestamp', () => {
  assert.equal(resolved('半小時後提醒我關火').instant, '2026-09-19T02:30:00.000Z');
  assert.equal(resolved('兩小時後提醒我出題').instant, '2026-09-19T04:00:00.000Z');
});

test('parses explicit month and day in Taipei time', () => {
  assert.equal(resolved('9月25日早上出題').instant, '2026-09-25T00:00:00.000Z');
  assert.equal(resolved('10/2 14:30出題').instant, '2026-10-02T06:30:00.000Z');
});

test('does not guess vague relative times', () => {
  assert.deepEqual(parseTimeIntent('晚點提醒我出題', REFERENCE), {
    status: 'ambiguous',
    reason: '「晚點」沒有明確時間',
  });
});

test('marks deadline language separately from reminder language', () => {
  assert.equal(resolved('今日下午一點之前出題').role, 'deadline');
  assert.equal(resolved('今天下午一點提醒我出題').role, 'reminder');
});

test('covers date-only, rolling clock, month-end, and recurring weekday edges', () => {
  assert.equal(resolved('明天出題').instant, '2026-09-20T00:00:00.000Z');
  assert.equal(resolved('9:00出題').instant, '2026-09-20T01:00:00.000Z');
  assert.equal(resolved('三天後下午三點出題').instant, '2026-09-22T07:00:00.000Z');
  assert.equal(resolved('下個月五號上午9點出題').instant, '2026-10-05T01:00:00.000Z');
  assert.equal(resolved('月底出題').instant, '2026-09-30T00:00:00.000Z');
  assert.equal(resolved('明年10月2日下午三點出題').instant, '2027-10-02T07:00:00.000Z');
  assert.equal(resolved('年底前出題').instant, '2026-12-31T00:00:00.000Z');
  assert.equal(resolved('每週一晚上8點倒垃圾').instant, '2026-09-21T12:00:00.000Z');
});

test('rejects past explicit times and incomplete calendar dates', () => {
  assert.deepEqual(parseTimeIntent('今天早上9點出題', REFERENCE), {
    status: 'ambiguous',
    reason: '指定時間已經過去',
  });
  assert.deepEqual(parseTimeIntent('下週早上出題', REFERENCE), {
    status: 'ambiguous',
    reason: '日期描述不完整',
  });
  assert.deepEqual(parseTimeIntent('明年早上出題', REFERENCE), {
    status: 'ambiguous',
    reason: '日期描述不完整',
  });
});
