import type { RepeatFreq } from './types';

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface RepeatHint {
  freq: RepeatFreq;
  count: number | null;
}

const COUNT_PATTERN = /(\d+)\s*次/;
const INFINITE_PATTERN = /(直到|提醒到|做到).{0,6}(完成|為止|才停|才算)/;

export function parseRepeatHint(text: string): RepeatHint | null {
  let freq: RepeatFreq | null = null;
  if (/每天|每日/.test(text)) freq = 'daily';
  else if (/每週|每周|每星期|每禮拜/.test(text)) freq = 'weekly';
  if (!freq) return null;

  if (INFINITE_PATTERN.test(text)) return { freq, count: null };
  const count = text.match(COUNT_PATTERN);
  return { freq, count: count ? Number(count[1]) : null };
}

export function addInterval(baseIso: string, freq: RepeatFreq): string {
  const days = freq === 'weekly' ? 7 : 1;
  return new Date(new Date(baseIso).getTime() + days * 86_400_000).toISOString();
}

/** 台北日期（YYYY-MM-DD）。 */
export function taipeiDate(iso: string): string {
  return new Date(new Date(iso).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 把時間點保留台北的時分，日期移到 targetDate（台北日期 YYYY-MM-DD）。
 * 已經在 targetDate 當天或之後的不動，回傳 null。
 */
export function rollToTaipeiDate(baseIso: string, targetDate: string): string | null {
  const days = Math.round((Date.parse(targetDate) - Date.parse(taipeiDate(baseIso))) / 86_400_000);
  if (!(days > 0)) return null;
  return new Date(new Date(baseIso).getTime() + days * 86_400_000).toISOString();
}

export function formatTaipei(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '時間格式錯誤';
  const local = new Date(instant.getTime() + TAIPEI_OFFSET_MS);
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}`;
}
