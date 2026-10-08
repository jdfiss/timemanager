import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTaipei, parseRepeatHint, rollToTaipeiDate } from '../src/timeparse.ts';

test('formats a valid instant in Taipei and never renders invalid values as NaN', () => {
  assert.equal(formatTaipei('2026-09-19T05:00:00.000Z'), '09/19 13:00');
  assert.equal(formatTaipei('12:00'), '時間格式錯誤');
});

test('parses repeat metadata independently of time intent', () => {
  assert.deepEqual(parseRepeatHint('每天早上出題，共10次'), { freq: 'daily', count: 10 });
  assert.deepEqual(parseRepeatHint('每週提醒到完成為止'), { freq: 'weekly', count: null });
});

test('rolls unfinished items to the target Taipei date, keeping the Taipei clock time', () => {
  // 10/07 23:00 台北 → 10/08 23:00 台北
  assert.equal(rollToTaipeiDate('2026-10-07T15:00:00.000Z', '2026-10-08'), '2026-10-08T15:00:00.000Z');
  // 10/05 08:00 台北，隔了好幾天 → 10/08 08:00 台北
  assert.equal(rollToTaipeiDate('2026-10-05T00:00:00.000Z', '2026-10-08'), '2026-10-08T00:00:00.000Z');
  // 已經是今天或之後的不動
  assert.equal(rollToTaipeiDate('2026-10-07T16:30:00.000Z', '2026-10-08'), null);
  assert.equal(rollToTaipeiDate('2026-10-09T00:00:00.000Z', '2026-10-08'), null);
});
