import { RepeatFreq } from './types';

// 模糊時段詞 → 固定時刻（台北時間），確保同一個詞每次都推到同一個時間點。
const TIME_WORD_HOUR: [string, number][] = [
  ['凌晨', 1],
  ['明早', 8], ['明晨', 8], ['今早', 8],
  ['早上', 8], ['早晨', 8], ['上午', 8],
  ['中午', 12], ['午間', 12],
  ['下午', 15],
  ['傍晚', 18], ['黃昏', 18],
  ['明晚', 20], ['今晚', 20],
  ['晚上', 20], ['晚間', 20], ['夜裡', 20], ['夜晚', 20],
  ['睡前', 23], ['深夜', 23],
];

// 只講日期沒講時段（例如單純「明天」）時的預設時刻。
const BARE_DAY_WORD = /(明天|明日|後天|大後天|今天|今日|下週|這週|本週|下星期|這星期|禮拜|星期|週[一二三四五六日天])/;

// 訊息裡若已有明確的數字時間（15:00、下午3點、9點半…），就不套用固定表，尊重原文。
const EXPLICIT_CLOCK = /([0-2]?\d)\s*[:：]\s*[0-5]?\d|([01]?\d|2[0-3])\s*[點点]/;

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 用文字中的模糊時段詞校正 LLM 判斷出的 ISO 時間的「時:分」，日期部分保留 LLM 的判斷。
 * 找不到任何線索時原樣傳回，避免蓋掉合理的明確時間。
 */
export function applyFixedTimeOfDay(text: string, isoString: string | null): string | null {
  if (!isoString) return isoString;
  if (EXPLICIT_CLOCK.test(text)) return isoString;

  let hour: number | null = null;
  for (const [word, h] of TIME_WORD_HOUR) {
    if (text.includes(word)) {
      hour = h;
      break;
    }
  }
  if (hour === null && BARE_DAY_WORD.test(text)) {
    hour = 8;
  }
  if (hour === null) return isoString;

  const original = new Date(isoString);
  if (isNaN(original.getTime())) return isoString;

  const taipei = new Date(original.getTime() + TAIPEI_OFFSET_MS);
  taipei.setUTCHours(hour, 0, 0, 0);
  return new Date(taipei.getTime() - TAIPEI_OFFSET_MS).toISOString();
}

export interface RepeatHint {
  freq: RepeatFreq;
  count: number | null;
}

const COUNT_PATTERN = /(\d+)\s*次/;
const INFINITE_PATTERN = /(直到|提醒到|做到).{0,6}(完成|為止|才停|才算)/;

/**
 * 從原文用規則判斷重複頻率／次數，比讓小模型自己填結構化欄位更穩定。
 * 「每天/每日」「每週/每星期/每禮拜」+「共N次」或「…為止/直到完成」（= 無限，null）。
 */
export function parseRepeatHint(text: string): RepeatHint | null {
  let freq: RepeatFreq | null = null;
  if (/每天|每日/.test(text)) freq = 'daily';
  else if (/每週|每周|每星期|每禮拜/.test(text)) freq = 'weekly';
  if (!freq) return null;

  if (INFINITE_PATTERN.test(text)) return { freq, count: null };

  const m = text.match(COUNT_PATTERN);
  if (m) return { freq, count: parseInt(m[1], 10) };

  return { freq, count: null };
}

export function addInterval(baseIso: string, freq: RepeatFreq): string {
  const days = freq === 'weekly' ? 7 : 1;
  return new Date(new Date(baseIso).getTime() + days * 86400000).toISOString();
}

export function formatTaipei(iso: string): string {
  const d = new Date(new Date(iso).getTime() + TAIPEI_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}
